/**
 * Retry and Circuit Breaker utilities for LLM providers
 */

export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterFactor: number;
}

export interface CircuitBreakerConfig {
    failureThreshold: number;
    recoveryTimeMs: number;
    halfOpenMaxAttempts: number;
}

type CircuitState = "closed" | "open" | "half-open";

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 30000,
    jitterFactor: 0.2
};

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeMs: 60000,
    halfOpenMaxAttempts: 2
};

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateBackoff(
    attempt: number,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
    const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
    const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, cappedDelay + jitter);
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryConfig> = {},
    shouldRetry: (error: Error, attempt: number) => boolean = () => true
): Promise<T> {
    const config = { ...DEFAULT_RETRY_CONFIG, ...options };
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            if (attempt >= config.maxRetries || !shouldRetry(lastError, attempt)) {
                throw lastError;
            }

            const delay = calculateBackoff(attempt, config);
            await sleep(delay);
        }
    }

    throw lastError ?? new Error("Retry failed with no error");
}

/**
 * Circuit Breaker class for provider resilience
 */
export class CircuitBreaker {
    private state: CircuitState = "closed";
    private failures = 0;
    private lastFailureTime = 0;
    private halfOpenAttempts = 0;
    private config: CircuitBreakerConfig;
    private name: string;

    constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
        this.name = name;
        this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    }

    getState(): CircuitState {
        this.checkRecovery();
        return this.state;
    }

    isOpen(): boolean {
        return this.getState() === "open";
    }

    private checkRecovery(): void {
        if (this.state === "open") {
            const elapsed = Date.now() - this.lastFailureTime;
            if (elapsed >= this.config.recoveryTimeMs) {
                this.state = "half-open";
                this.halfOpenAttempts = 0;
            }
        }
    }

    recordSuccess(): void {
        this.failures = 0;
        this.state = "closed";
        this.halfOpenAttempts = 0;
    }

    recordFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();

        if (this.state === "half-open") {
            this.halfOpenAttempts++;
            if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
                this.state = "open";
            }
        } else if (this.failures >= this.config.failureThreshold) {
            this.state = "open";
        }
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        this.checkRecovery();

        if (this.state === "open") {
            throw new CircuitOpenError(this.name);
        }

        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    reset(): void {
        this.state = "closed";
        this.failures = 0;
        this.halfOpenAttempts = 0;
    }
}

export class CircuitOpenError extends Error {
    constructor(providerName: string) {
        super(`Circuit breaker open for provider: ${providerName}`);
        this.name = "CircuitOpenError";
    }
}

/**
 * Rate limiter using token bucket algorithm
 */
export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private maxTokens: number;
    private refillRate: number; // tokens per second

    constructor(requestsPerMinute: number) {
        this.maxTokens = requestsPerMinute;
        this.tokens = requestsPerMinute;
        this.refillRate = requestsPerMinute / 60;
        this.lastRefill = Date.now();
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        const tokensToAdd = elapsed * this.refillRate;
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }

    async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens--;
            return;
        }

        // Wait for a token to become available
        const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
        await sleep(waitTime);
        this.refill();
        this.tokens--;
    }

    tryAcquire(): boolean {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens--;
            return true;
        }
        return false;
    }

    getAvailableTokens(): number {
        this.refill();
        return Math.floor(this.tokens);
    }
}
