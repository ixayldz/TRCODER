/**
 * Rate Limiter for API endpoints
 * 
 * Per-key rate limiting with sliding window algorithm
 */

interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
    skipFailedRequests?: boolean;
    keyGenerator?: (req: RateLimitRequest) => string;
}

interface RateLimitRequest {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
}

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
    windowMs: 60000, // 1 minute
    maxRequests: 100,
    skipFailedRequests: false
};

export class RateLimiter {
    private limits: Map<string, RateLimitEntry> = new Map();
    private config: RateLimitConfig;
    private cleanupInterval: NodeJS.Timeout;

    constructor(config: Partial<RateLimitConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Cleanup expired entries every minute
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }

    private getKey(req: RateLimitRequest): string {
        if (this.config.keyGenerator) {
            return this.config.keyGenerator(req);
        }

        // Default: use Authorization header or IP
        const auth = req.headers.authorization;
        if (auth) {
            const token = Array.isArray(auth) ? auth[0] : auth;
            return `auth:${token.slice(-16)}`; // Last 16 chars of token
        }

        return `ip:${req.ip ?? "unknown"}`;
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.limits) {
            if (entry.resetTime <= now) {
                this.limits.delete(key);
            }
        }
    }

    check(req: RateLimitRequest): {
        allowed: boolean;
        remaining: number;
        resetAt: number;
        retryAfter?: number;
    } {
        const key = this.getKey(req);
        const now = Date.now();
        let entry = this.limits.get(key);

        // Create new entry if expired or doesn't exist
        if (!entry || entry.resetTime <= now) {
            entry = {
                count: 0,
                resetTime: now + this.config.windowMs
            };
            this.limits.set(key, entry);
        }

        const remaining = this.config.maxRequests - entry.count;

        if (entry.count >= this.config.maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: entry.resetTime,
                retryAfter: Math.ceil((entry.resetTime - now) / 1000)
            };
        }

        return {
            allowed: true,
            remaining: remaining - 1,
            resetAt: entry.resetTime
        };
    }

    consume(req: RateLimitRequest): void {
        const key = this.getKey(req);
        const entry = this.limits.get(key);
        if (entry) {
            entry.count++;
        }
    }

    reset(req: RateLimitRequest): void {
        const key = this.getKey(req);
        this.limits.delete(key);
    }

    getStats(): {
        activeKeys: number;
        totalRequests: number;
    } {
        let totalRequests = 0;
        for (const entry of this.limits.values()) {
            totalRequests += entry.count;
        }
        return {
            activeKeys: this.limits.size,
            totalRequests
        };
    }

    destroy(): void {
        clearInterval(this.cleanupInterval);
        this.limits.clear();
    }
}

/**
 * Concurrent run limiter
 * Limits number of simultaneous runs per user/org
 */
export class ConcurrentRunLimiter {
    private activeRuns: Map<string, Set<string>> = new Map();
    private maxConcurrent: number;

    constructor(maxConcurrent: number = 5) {
        this.maxConcurrent = maxConcurrent;
    }

    private getKey(orgId: string, userId?: string): string {
        return userId ? `${orgId}:${userId}` : orgId;
    }

    canStart(orgId: string, userId?: string): boolean {
        const key = this.getKey(orgId, userId);
        const runs = this.activeRuns.get(key);
        if (!runs) return true;
        return runs.size < this.maxConcurrent;
    }

    start(orgId: string, runId: string, userId?: string): boolean {
        if (!this.canStart(orgId, userId)) {
            return false;
        }

        const key = this.getKey(orgId, userId);
        let runs = this.activeRuns.get(key);
        if (!runs) {
            runs = new Set();
            this.activeRuns.set(key, runs);
        }
        runs.add(runId);
        return true;
    }

    end(orgId: string, runId: string, userId?: string): void {
        const key = this.getKey(orgId, userId);
        const runs = this.activeRuns.get(key);
        if (runs) {
            runs.delete(runId);
            if (runs.size === 0) {
                this.activeRuns.delete(key);
            }
        }
    }

    getActiveCount(orgId: string, userId?: string): number {
        const key = this.getKey(orgId, userId);
        const runs = this.activeRuns.get(key);
        return runs?.size ?? 0;
    }

    getMaxConcurrent(): number {
        return this.maxConcurrent;
    }

    setMaxConcurrent(max: number): void {
        this.maxConcurrent = max;
    }
}

/**
 * Cost-based rate limiter
 * Limits spending per time window
 */
export class CostRateLimiter {
    private costs: Map<string, { spent: number; resetTime: number }> = new Map();
    private maxCostPerWindow: number;
    private windowMs: number;

    constructor(maxCostPerWindow: number = 10, windowMs: number = 3600000) {
        this.maxCostPerWindow = maxCostPerWindow;
        this.windowMs = windowMs;
    }

    private getKey(orgId: string): string {
        return `cost:${orgId}`;
    }

    check(orgId: string, estimatedCost: number): {
        allowed: boolean;
        remaining: number;
        resetAt: number;
    } {
        const key = this.getKey(orgId);
        const now = Date.now();
        let entry = this.costs.get(key);

        if (!entry || entry.resetTime <= now) {
            entry = {
                spent: 0,
                resetTime: now + this.windowMs
            };
            this.costs.set(key, entry);
        }

        const remaining = this.maxCostPerWindow - entry.spent;

        if (entry.spent + estimatedCost > this.maxCostPerWindow) {
            return {
                allowed: false,
                remaining: Math.max(0, remaining),
                resetAt: entry.resetTime
            };
        }

        return {
            allowed: true,
            remaining: remaining - estimatedCost,
            resetAt: entry.resetTime
        };
    }

    consume(orgId: string, cost: number): void {
        const key = this.getKey(orgId);
        const entry = this.costs.get(key);
        if (entry) {
            entry.spent += cost;
        }
    }

    getSpent(orgId: string): number {
        const key = this.getKey(orgId);
        const entry = this.costs.get(key);
        return entry?.spent ?? 0;
    }
}

/**
 * Create Fastify rate limit plugin-compatible middleware
 */
export function createRateLimitMiddleware(limiter: RateLimiter) {
    return async function rateLimitHandler(
        request: { headers: Record<string, string | string[] | undefined>; ip?: string },
        reply: { code: (code: number) => { send: (body: unknown) => void }; header: (name: string, value: string) => void }
    ) {
        const result = limiter.check(request);

        reply.header("X-RateLimit-Limit", String(100));
        reply.header("X-RateLimit-Remaining", String(result.remaining));
        reply.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

        if (!result.allowed) {
            reply.header("Retry-After", String(result.retryAfter));
            reply.code(429).send({
                error: "Too Many Requests",
                message: `Rate limit exceeded. Retry after ${result.retryAfter} seconds.`,
                retryAfter: result.retryAfter
            });
            return;
        }

        limiter.consume(request);
    };
}
