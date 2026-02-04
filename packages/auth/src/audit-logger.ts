/**
 * Audit Logger
 * 
 * Tracks security-relevant events for compliance and forensics.
 * Stores audit logs with user attribution and resource context.
 */

export type AuditAction =
    | "LOGIN"
    | "LOGIN_FAILED"
    | "LOGOUT"
    | "REGISTER"
    | "PASSWORD_CHANGE"
    | "PASSWORD_RESET"
    | "API_KEY_CREATE"
    | "API_KEY_REVOKE"
    | "SUBSCRIPTION_CREATE"
    | "SUBSCRIPTION_CANCEL"
    | "SUBSCRIPTION_CHANGE"
    | "CREDIT_PURCHASE"
    | "CREDIT_USAGE"
    | "PLAN_APPROVE"
    | "RUN_START"
    | "RUN_CANCEL"
    | "PERMISSION_DENIED"
    | "ADMIN_ACTION"
    | "DATA_EXPORT"
    | "DATA_DELETE"
    | "SETTINGS_CHANGE";

export interface AuditEntry {
    id: string;
    timestamp: string;
    action: AuditAction;
    userId?: string;
    orgId?: string;
    targetType?: string;       // e.g., "api_key", "subscription", "run"
    targetId?: string;         // ID of the affected resource
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
    status: "success" | "failure";
    reason?: string;           // For failures
}

export interface AuditStore {
    save(entry: AuditEntry): Promise<void>;
    query(filters: AuditQueryFilters): Promise<AuditEntry[]>;
}

export interface AuditQueryFilters {
    userId?: string;
    orgId?: string;
    action?: AuditAction | AuditAction[];
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
}

export interface AuditLoggerConfig {
    store: AuditStore;
    enabled?: boolean;
    includeMetadata?: boolean;
}

/**
 * Audit Logger
 */
export class AuditLogger {
    private config: Required<AuditLoggerConfig>;

    constructor(config: AuditLoggerConfig) {
        this.config = {
            enabled: true,
            includeMetadata: true,
            ...config
        };
    }

    /**
     * Log an audit event
     */
    async log(params: {
        action: AuditAction;
        userId?: string;
        orgId?: string;
        targetType?: string;
        targetId?: string;
        ipAddress?: string;
        userAgent?: string;
        metadata?: Record<string, unknown>;
        status: "success" | "failure";
        reason?: string;
    }): Promise<void> {
        if (!this.config.enabled) return;

        const entry: AuditEntry = {
            id: generateAuditId(),
            timestamp: new Date().toISOString(),
            action: params.action,
            userId: params.userId,
            orgId: params.orgId,
            targetType: params.targetType,
            targetId: params.targetId,
            ipAddress: params.ipAddress ? maskIp(params.ipAddress) : undefined,
            userAgent: params.userAgent,
            metadata: this.config.includeMetadata ? params.metadata : undefined,
            status: params.status,
            reason: params.reason
        };

        try {
            await this.config.store.save(entry);
        } catch (err) {
            // Don't fail the operation if audit logging fails
            console.error("[AuditLogger] Failed to save audit entry:", err);
        }
    }

    /**
     * Log successful login
     */
    async logLogin(params: {
        userId: string;
        orgId?: string;
        method: "password" | "oauth" | "api_key";
        ipAddress?: string;
        userAgent?: string;
    }): Promise<void> {
        await this.log({
            action: "LOGIN",
            userId: params.userId,
            orgId: params.orgId,
            ipAddress: params.ipAddress,
            userAgent: params.userAgent,
            metadata: { method: params.method },
            status: "success"
        });
    }

    /**
     * Log failed login
     */
    async logLoginFailed(params: {
        email?: string;
        reason: string;
        ipAddress?: string;
        userAgent?: string;
    }): Promise<void> {
        await this.log({
            action: "LOGIN_FAILED",
            ipAddress: params.ipAddress,
            userAgent: params.userAgent,
            metadata: { email: params.email ? maskEmail(params.email) : undefined },
            status: "failure",
            reason: params.reason
        });
    }

    /**
     * Log API key creation
     */
    async logApiKeyCreate(params: {
        userId: string;
        orgId: string;
        keyId: string;
        scopes: string[];
        ipAddress?: string;
    }): Promise<void> {
        await this.log({
            action: "API_KEY_CREATE",
            userId: params.userId,
            orgId: params.orgId,
            targetType: "api_key",
            targetId: params.keyId,
            ipAddress: params.ipAddress,
            metadata: { scopes: params.scopes },
            status: "success"
        });
    }

    /**
     * Log subscription change
     */
    async logSubscriptionChange(params: {
        userId: string;
        orgId: string;
        action: "SUBSCRIPTION_CREATE" | "SUBSCRIPTION_CANCEL" | "SUBSCRIPTION_CHANGE";
        oldPlan?: string;
        newPlan: string;
        ipAddress?: string;
    }): Promise<void> {
        await this.log({
            action: params.action,
            userId: params.userId,
            orgId: params.orgId,
            targetType: "subscription",
            ipAddress: params.ipAddress,
            metadata: { oldPlan: params.oldPlan, newPlan: params.newPlan },
            status: "success"
        });
    }

    /**
     * Log permission denied
     */
    async logPermissionDenied(params: {
        userId?: string;
        orgId?: string;
        action: string;
        resource: string;
        reason: string;
        ipAddress?: string;
    }): Promise<void> {
        await this.log({
            action: "PERMISSION_DENIED",
            userId: params.userId,
            orgId: params.orgId,
            targetType: params.resource,
            ipAddress: params.ipAddress,
            metadata: { attemptedAction: params.action },
            status: "failure",
            reason: params.reason
        });
    }

    /**
     * Query audit logs
     */
    async query(filters: AuditQueryFilters): Promise<AuditEntry[]> {
        return this.config.store.query(filters);
    }
}

/**
 * In-memory audit store (for development/testing)
 */
export class InMemoryAuditStore implements AuditStore {
    private entries: AuditEntry[] = [];
    private maxSize: number;

    constructor(maxSize = 10000) {
        this.maxSize = maxSize;
    }

    async save(entry: AuditEntry): Promise<void> {
        this.entries.push(entry);
        if (this.entries.length > this.maxSize) {
            this.entries.shift();
        }
    }

    async query(filters: AuditQueryFilters): Promise<AuditEntry[]> {
        let results = [...this.entries];

        if (filters.userId) {
            results = results.filter(e => e.userId === filters.userId);
        }
        if (filters.orgId) {
            results = results.filter(e => e.orgId === filters.orgId);
        }
        if (filters.action) {
            const actions = Array.isArray(filters.action) ? filters.action : [filters.action];
            results = results.filter(e => actions.includes(e.action));
        }
        if (filters.startDate) {
            results = results.filter(e => new Date(e.timestamp) >= filters.startDate!);
        }
        if (filters.endDate) {
            results = results.filter(e => new Date(e.timestamp) <= filters.endDate!);
        }

        // Sort by timestamp descending
        results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        // Apply pagination
        const offset = filters.offset ?? 0;
        const limit = filters.limit ?? 100;
        return results.slice(offset, offset + limit);
    }
}

/**
 * PostgreSQL audit store
 */
export class PgAuditStore implements AuditStore {
    constructor(
        private dbQuery: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
        private exec: (sql: string, params?: unknown[]) => Promise<void>
    ) { }

    async save(entry: AuditEntry): Promise<void> {
        await this.exec(`
            INSERT INTO audit_logs (id, timestamp, action, user_id, org_id, target_type, target_id, ip_address, user_agent, metadata, status, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
            entry.id,
            entry.timestamp,
            entry.action,
            entry.userId,
            entry.orgId,
            entry.targetType,
            entry.targetId,
            entry.ipAddress,
            entry.userAgent,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            entry.status,
            entry.reason
        ]);
    }

    async query(filters: AuditQueryFilters): Promise<AuditEntry[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (filters.userId) {
            conditions.push(`user_id = $${paramIndex++}`);
            params.push(filters.userId);
        }
        if (filters.orgId) {
            conditions.push(`org_id = $${paramIndex++}`);
            params.push(filters.orgId);
        }
        if (filters.action) {
            const actions = Array.isArray(filters.action) ? filters.action : [filters.action];
            conditions.push(`action = ANY($${paramIndex++})`);
            params.push(actions);
        }
        if (filters.startDate) {
            conditions.push(`timestamp >= $${paramIndex++}`);
            params.push(filters.startDate.toISOString());
        }
        if (filters.endDate) {
            conditions.push(`timestamp <= $${paramIndex++}`);
            params.push(filters.endDate.toISOString());
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = filters.limit ?? 100;
        const offset = filters.offset ?? 0;

        const rows = await this.dbQuery<AuditEntry>(`
            SELECT * FROM audit_logs
            ${whereClause}
            ORDER BY timestamp DESC
            LIMIT ${limit} OFFSET ${offset}
        `, params);

        return rows;
    }
}

/**
 * Audit logs table migration
 */
export const AUDIT_LOGS_MIGRATION = `
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL,
    action VARCHAR(50) NOT NULL,
    user_id VARCHAR(36),
    org_id VARCHAR(36),
    target_type VARCHAR(50),
    target_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB,
    status VARCHAR(10) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
`;

// Utility functions
function generateAuditId(): string {
    return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function maskEmail(email: string): string {
    const [local, domain] = email.split("@");
    if (!domain) return "***@***";
    const maskedLocal = local.length > 2
        ? local[0] + "*".repeat(local.length - 2) + local[local.length - 1]
        : "**";
    return `${maskedLocal}@${domain}`;
}

function maskIp(ip: string): string {
    if (ip.includes(":")) {
        // IPv6 - mask last 4 segments
        const parts = ip.split(":");
        return parts.slice(0, 4).join(":") + ":****:****:****:****";
    }
    // IPv4 - mask last octet
    const parts = ip.split(".");
    return parts.slice(0, 3).join(".") + ".***";
}
