/**
 * Webhook Idempotency Handler
 * 
 * Prevents duplicate processing of webhooks by tracking event IDs.
 * Uses in-memory storage with optional database persistence.
 */

export interface IdempotencyConfig {
    ttlMs: number;                    // How long to remember processed events
    maxSize?: number;                 // Maximum events to track (LRU eviction)
    store?: IdempotencyStore;         // Optional persistent store
}

export interface IdempotencyStore {
    has(eventId: string): Promise<boolean>;
    add(eventId: string, processedAt: Date): Promise<void>;
    cleanup(olderThan: Date): Promise<number>;
}

interface ProcessedEvent {
    eventId: string;
    processedAt: number;
}

/**
 * In-memory idempotency handler with LRU eviction
 */
export class WebhookIdempotency {
    private processed: Map<string, number> = new Map();
    private config: Required<IdempotencyConfig>;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(config: IdempotencyConfig) {
        this.config = {
            maxSize: 10000,
            store: undefined as unknown as IdempotencyStore,
            ...config
        };

        // Cleanup expired events every 5 minutes
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    /**
     * Check if event has already been processed
     */
    async isProcessed(eventId: string): Promise<boolean> {
        // Check memory first
        if (this.processed.has(eventId)) {
            return true;
        }

        // Check persistent store if available
        if (this.config.store) {
            return await this.config.store.has(eventId);
        }

        return false;
    }

    /**
     * Mark event as processed
     */
    async markProcessed(eventId: string): Promise<void> {
        const now = Date.now();

        // Evict oldest if at capacity
        if (this.processed.size >= this.config.maxSize) {
            this.evictOldest();
        }

        this.processed.set(eventId, now);

        // Persist if store available
        if (this.config.store) {
            await this.config.store.add(eventId, new Date(now));
        }
    }

    /**
     * Process webhook with idempotency check
     * Returns true if processed, false if duplicate
     */
    async process<T>(
        eventId: string,
        handler: () => Promise<T>
    ): Promise<{ processed: boolean; result?: T; duplicate: boolean }> {
        if (await this.isProcessed(eventId)) {
            return { processed: false, duplicate: true };
        }

        try {
            const result = await handler();
            await this.markProcessed(eventId);
            return { processed: true, result, duplicate: false };
        } catch (error) {
            // Don't mark as processed if handler failed
            throw error;
        }
    }

    /**
     * Evict oldest entry (LRU)
     */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, time] of this.processed.entries()) {
            if (time < oldestTime) {
                oldestTime = time;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.processed.delete(oldestKey);
        }
    }

    /**
     * Cleanup expired entries
     */
    private async cleanup(): Promise<void> {
        const expiredBefore = Date.now() - this.config.ttlMs;
        let cleaned = 0;

        for (const [key, time] of this.processed.entries()) {
            if (time < expiredBefore) {
                this.processed.delete(key);
                cleaned++;
            }
        }

        // Cleanup persistent store
        if (this.config.store) {
            await this.config.store.cleanup(new Date(expiredBefore));
        }

        if (cleaned > 0) {
            console.log(`[WebhookIdempotency] Cleaned up ${cleaned} expired events`);
        }
    }

    /**
     * Get stats
     */
    getStats(): { size: number; maxSize: number } {
        return {
            size: this.processed.size,
            maxSize: this.config.maxSize
        };
    }

    /**
     * Destroy and cleanup
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.processed.clear();
    }
}

/**
 * Database-backed idempotency store (PostgreSQL)
 */
export class PgIdempotencyStore implements IdempotencyStore {
    constructor(
        private query: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
        private exec: (sql: string, params?: unknown[]) => Promise<void>
    ) { }

    async has(eventId: string): Promise<boolean> {
        const result = await this.query<{ cnt: number }>(
            "SELECT COUNT(1) as cnt FROM webhook_events WHERE event_id = $1",
            [eventId]
        );
        return (result[0]?.cnt ?? 0) > 0;
    }

    async add(eventId: string, processedAt: Date): Promise<void> {
        await this.exec(
            "INSERT INTO webhook_events (event_id, processed_at) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING",
            [eventId, processedAt.toISOString()]
        );
    }

    async cleanup(olderThan: Date): Promise<number> {
        const result = await this.query<{ cnt: number }>(
            "WITH deleted AS (DELETE FROM webhook_events WHERE processed_at < $1 RETURNING 1) SELECT COUNT(1) as cnt FROM deleted",
            [olderThan.toISOString()]
        );
        return result[0]?.cnt ?? 0;
    }
}

/**
 * Create webhook_events table migration
 */
export const WEBHOOK_EVENTS_MIGRATION = `
CREATE TABLE IF NOT EXISTS webhook_events (
    event_id VARCHAR(255) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON webhook_events(processed_at);
`;

/**
 * Pre-configured idempotency handlers
 */
export const IdempotencyHandlers = {
    /**
     * Stripe webhook idempotency (24 hour TTL)
     */
    stripe: () => new WebhookIdempotency({
        ttlMs: 24 * 60 * 60 * 1000,  // 24 hours
        maxSize: 10000
    }),

    /**
     * GitHub webhook idempotency (1 hour TTL)
     */
    github: () => new WebhookIdempotency({
        ttlMs: 60 * 60 * 1000,  // 1 hour
        maxSize: 5000
    })
};
