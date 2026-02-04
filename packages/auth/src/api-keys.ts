/**
 * API Key Management
 */

import { createHash, randomBytes } from "crypto";
import { ApiKey, ApiKeyResult, ApiKeyScope } from "./types";

const API_KEY_PREFIX_LIVE = "trc_live_";
const API_KEY_PREFIX_TEST = "trc_test_";
const API_KEY_LENGTH = 32;

export interface ApiKeyStore {
    create(key: Omit<ApiKey, "id" | "created_at">): Promise<ApiKey>;
    findByHash(keyHash: string): Promise<ApiKey | null>;
    findByOrg(orgId: string): Promise<ApiKey[]>;
    findById(id: string): Promise<ApiKey | null>;
    updateLastUsed(id: string): Promise<void>;
    revoke(id: string): Promise<void>;
}

export class ApiKeyManager {
    constructor(private store: ApiKeyStore) { }

    /**
     * Generate a new API key
     */
    async create(options: {
        name: string;
        orgId: string;
        userId: string;
        scopes?: ApiKeyScope[];
        expiresAt?: Date;
        isTest?: boolean;
    }): Promise<ApiKeyResult> {
        const prefix = options.isTest ? API_KEY_PREFIX_TEST : API_KEY_PREFIX_LIVE;
        const randomPart = randomBytes(API_KEY_LENGTH).toString("base64url");
        const fullKey = `${prefix}${randomPart}`;
        const keyHash = this.hashKey(fullKey);
        const keyPrefix = `${prefix}${randomPart.slice(0, 8)}...`;

        const apiKey = await this.store.create({
            key_hash: keyHash,
            key_prefix: keyPrefix,
            name: options.name,
            org_id: options.orgId,
            user_id: options.userId,
            scopes: options.scopes ?? ["runs:read", "runs:write", "projects:read"],
            expires_at: options.expiresAt?.toISOString()
        });

        return {
            id: apiKey.id,
            key: fullKey,  // Only returned once!
            key_prefix: keyPrefix,
            name: apiKey.name,
            scopes: apiKey.scopes,
            created_at: apiKey.created_at,
            expires_at: apiKey.expires_at
        };
    }

    /**
     * Validate an API key and return the associated data
     */
    async validate(key: string): Promise<{
        valid: boolean;
        apiKey?: ApiKey;
        error?: string;
    }> {
        // Check format
        if (!key.startsWith(API_KEY_PREFIX_LIVE) && !key.startsWith(API_KEY_PREFIX_TEST)) {
            return { valid: false, error: "Invalid API key format" };
        }

        const keyHash = this.hashKey(key);
        const apiKey = await this.store.findByHash(keyHash);

        if (!apiKey) {
            return { valid: false, error: "API key not found" };
        }

        if (apiKey.revoked_at) {
            return { valid: false, error: "API key has been revoked" };
        }

        if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
            return { valid: false, error: "API key has expired" };
        }

        // Update last used timestamp
        await this.store.updateLastUsed(apiKey.id);

        return { valid: true, apiKey };
    }

    /**
     * Check if a key has required scopes
     */
    hasScopes(apiKey: ApiKey, requiredScopes: ApiKeyScope[]): boolean {
        if (apiKey.scopes.includes("admin")) {
            return true;
        }
        return requiredScopes.every(scope => apiKey.scopes.includes(scope));
    }

    /**
     * List API keys for an organization
     */
    async listByOrg(orgId: string): Promise<Omit<ApiKey, "key_hash">[]> {
        const keys = await this.store.findByOrg(orgId);
        return keys.map(({ key_hash, ...rest }) => rest);
    }

    /**
     * Revoke an API key
     */
    async revoke(id: string, orgId: string): Promise<boolean> {
        const apiKey = await this.store.findById(id);
        if (!apiKey || apiKey.org_id !== orgId) {
            return false;
        }
        await this.store.revoke(id);
        return true;
    }

    /**
     * Hash an API key for storage
     */
    private hashKey(key: string): string {
        return createHash("sha256").update(key).digest("hex");
    }
}

/**
 * Parse Authorization header
 */
export function parseAuthHeader(header: string | undefined): {
    type: "bearer" | "apikey" | null;
    token: string | null;
} {
    if (!header) {
        return { type: null, token: null };
    }

    const parts = header.split(" ");
    if (parts.length !== 2) {
        return { type: null, token: null };
    }

    const [scheme, token] = parts;

    if (scheme.toLowerCase() === "bearer") {
        // Could be JWT or API key
        if (token.startsWith("trc_")) {
            return { type: "apikey", token };
        }
        return { type: "bearer", token };
    }

    return { type: null, token: null };
}
