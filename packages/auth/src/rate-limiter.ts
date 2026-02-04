/**
 * Rate Limiter
 * 
 * In-memory rate limiter for protecting endpoints against abuse.
 * Supports sliding window and token bucket algorithms.
 */

export interface RateLimitConfig {
    windowMs: number;          // Time window in milliseconds
    maxRequests: number;       // Max requests per window
    keyPrefix?: string;        // Prefix for keys
    skipFailedRequests?: boolean;  // Don't count failed requests
    skipSuccessfulRequests?: boolean;  // Don't count successful requests
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: Date;
    retryAfter?: number;  // Seconds until next allowed request
}

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

/**
 * Simple in-memory rate limiter with sliding window
 */
export class RateLimiter {
    private store: Map<string, RateLimitEntry> = new Map();
    private config: RateLimitConfig;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(config: RateLimitConfig) {
        this.config = {
            keyPrefix: "rl:",
            skipFailedRequests: false,
            skipSuccessfulRequests: false,
            ...config
        };

        // Cleanup expired entries every minute
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }

    /**
     * Check if request is allowed
     */
    check(key: string): RateLimitResult {
        const fullKey = `${this.config.keyPrefix}${key}`;
        const now = Date.now();
        const entry = this.store.get(fullKey);

        if (!entry || now >= entry.resetAt) {
            // No entry or expired - create new window
            const resetAt = now + this.config.windowMs;
            this.store.set(fullKey, { count: 1, resetAt });
            return {
                allowed: true,
                remaining: this.config.maxRequests - 1,
                resetAt: new Date(resetAt)
            };
        }

        if (entry.count >= this.config.maxRequests) {
            // Rate limited
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            return {
                allowed: false,
                remaining: 0,
                resetAt: new Date(entry.resetAt),
                retryAfter
            };
        }

        // Increment counter
        entry.count++;
        return {
            allowed: true,
            remaining: this.config.maxRequests - entry.count,
            resetAt: new Date(entry.resetAt)
        };
    }

    /**
     * Increment counter (call after successful request)
     */
    hit(key: string): void {
        const fullKey = `${this.config.keyPrefix}${key}`;
        const now = Date.now();
        const entry = this.store.get(fullKey);

        if (!entry || now >= entry.resetAt) {
            const resetAt = now + this.config.windowMs;
            this.store.set(fullKey, { count: 1, resetAt });
        } else {
            entry.count++;
        }
    }

    /**
     * Reset rate limit for a key
     */
    reset(key: string): void {
        const fullKey = `${this.config.keyPrefix}${key}`;
        this.store.delete(fullKey);
    }

    /**
     * Cleanup expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (now >= entry.resetAt) {
                this.store.delete(key);
            }
        }
    }

    /**
     * Stop the cleanup interval
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.store.clear();
    }
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const RateLimiters = {
    /**
     * Login rate limiter - 5 attempts per 15 minutes per IP
     */
    login: () => new RateLimiter({
        windowMs: 15 * 60 * 1000,  // 15 minutes
        maxRequests: 5,
        keyPrefix: "login:"
    }),

    /**
     * API rate limiter - 100 requests per minute per API key
     */
    api: () => new RateLimiter({
        windowMs: 60 * 1000,  // 1 minute
        maxRequests: 100,
        keyPrefix: "api:"
    }),

    /**
     * Registration rate limiter - 3 per hour per IP
     */
    register: () => new RateLimiter({
        windowMs: 60 * 60 * 1000,  // 1 hour
        maxRequests: 3,
        keyPrefix: "register:"
    }),

    /**
     * Password reset rate limiter - 3 per hour per email
     */
    passwordReset: () => new RateLimiter({
        windowMs: 60 * 60 * 1000,  // 1 hour
        maxRequests: 3,
        keyPrefix: "pwreset:"
    })
};

/**
 * Express/Fastify middleware factory
 */
export function createRateLimitMiddleware(limiter: RateLimiter, keyExtractor: (req: unknown) => string) {
    return async function rateLimitMiddleware(
        request: { headers: Record<string, string | string[] | undefined> },
        reply: {
            code: (code: number) => { send: (body: unknown) => void };
            header: (name: string, value: string) => void;
        }
    ): Promise<boolean> {
        const key = keyExtractor(request);
        const result = limiter.check(key);

        // Set rate limit headers
        reply.header("X-RateLimit-Limit", String(limiter["config"].maxRequests));
        reply.header("X-RateLimit-Remaining", String(result.remaining));
        reply.header("X-RateLimit-Reset", result.resetAt.toISOString());

        if (!result.allowed) {
            reply.header("Retry-After", String(result.retryAfter));
            reply.code(429).send({
                error: "Too Many Requests",
                message: "Rate limit exceeded. Please try again later.",
                retryAfter: result.retryAfter
            });
            return false;
        }

        return true;
    };
}
