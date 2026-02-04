/**
 * Circuit Breaker Pattern
 * 
 * Prevents cascading failures by detecting failures and stopping
 * requests to failing services.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
    name: string;
    failureThreshold: number;      // Number of failures before opening
    successThreshold: number;      // Number of successes to close from half-open
    timeout: number;               // Time in ms before trying again (half-open)
    volumeThreshold?: number;      // Minimum requests before calculating failure rate
    failureRateThreshold?: number; // Percentage (0-100) of failures to trigger open
    onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
    onSuccess?: (name: string, duration: number) => void;
    onFailure?: (name: string, error: Error | unknown) => void;
}

interface CircuitStats {
    failures: number;
    successes: number;
    lastFailure: number | null;
    lastSuccess: number | null;
    totalRequests: number;
}

export class CircuitBreaker {
    private state: CircuitState = "CLOSED";
    private stats: CircuitStats = {
        failures: 0,
        successes: 0,
        lastFailure: null,
        lastSuccess: null,
        totalRequests: 0
    };
    private nextAttempt: number = 0;
    private config: Required<CircuitBreakerConfig>;

    constructor(config: CircuitBreakerConfig) {
        this.config = {
            volumeThreshold: 5,
            failureRateThreshold: 50,
            onStateChange: () => { },
            onSuccess: () => { },
            onFailure: () => { },
            ...config
        };
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (!this.canExecute()) {
            throw new CircuitBreakerError(
                `Circuit breaker '${this.config.name}' is OPEN`,
                this.config.name,
                this.state
            );
        }

        const startTime = Date.now();

        try {
            const result = await fn();
            this.recordSuccess(Date.now() - startTime);
            return result;
        } catch (error) {
            this.recordFailure(error);
            throw error;
        }
    }

    /**
     * Check if circuit allows execution
     */
    canExecute(): boolean {
        if (this.state === "CLOSED") {
            return true;
        }

        if (this.state === "OPEN") {
            if (Date.now() >= this.nextAttempt) {
                this.transition("HALF_OPEN");
                return true;
            }
            return false;
        }

        // HALF_OPEN - allow one request through
        return true;
    }

    /**
     * Record a successful execution
     */
    private recordSuccess(duration: number): void {
        this.stats.successes++;
        this.stats.totalRequests++;
        this.stats.lastSuccess = Date.now();
        this.config.onSuccess(this.config.name, duration);

        if (this.state === "HALF_OPEN") {
            if (this.stats.successes >= this.config.successThreshold) {
                this.transition("CLOSED");
                this.resetStats();
            }
        } else if (this.state === "CLOSED") {
            // Reset failure count on success in closed state
            this.stats.failures = 0;
        }
    }

    /**
     * Record a failed execution
     */
    private recordFailure(error: Error | unknown): void {
        this.stats.failures++;
        this.stats.totalRequests++;
        this.stats.lastFailure = Date.now();
        this.config.onFailure(this.config.name, error);

        if (this.state === "HALF_OPEN") {
            // Any failure in half-open goes back to open
            this.transition("OPEN");
            return;
        }

        if (this.state === "CLOSED") {
            if (this.shouldOpen()) {
                this.transition("OPEN");
            }
        }
    }

    /**
     * Check if circuit should open based on failure metrics
     */
    private shouldOpen(): boolean {
        // Check absolute failure threshold
        if (this.stats.failures >= this.config.failureThreshold) {
            return true;
        }

        // Check failure rate if volume threshold met
        if (this.stats.totalRequests >= this.config.volumeThreshold) {
            const failureRate = (this.stats.failures / this.stats.totalRequests) * 100;
            if (failureRate >= this.config.failureRateThreshold) {
                return true;
            }
        }

        return false;
    }

    /**
     * Transition to a new state
     */
    private transition(newState: CircuitState): void {
        const oldState = this.state;
        this.state = newState;

        if (newState === "OPEN") {
            this.nextAttempt = Date.now() + this.config.timeout;
            this.stats.successes = 0;  // Reset for half-open tracking
        }

        if (newState === "HALF_OPEN") {
            this.stats.successes = 0;
            this.stats.failures = 0;
        }

        this.config.onStateChange(oldState, newState, this.config.name);
        console.log(`[CircuitBreaker:${this.config.name}] ${oldState} -> ${newState}`);
    }

    /**
     * Reset all stats
     */
    private resetStats(): void {
        this.stats = {
            failures: 0,
            successes: 0,
            lastFailure: null,
            lastSuccess: null,
            totalRequests: 0
        };
    }

    /**
     * Get current state and stats
     */
    getStatus(): {
        state: CircuitState;
        stats: CircuitStats;
        nextAttempt: number | null;
    } {
        return {
            state: this.state,
            stats: { ...this.stats },
            nextAttempt: this.state === "OPEN" ? this.nextAttempt : null
        };
    }

    /**
     * Force circuit to specific state (for testing/admin)
     */
    forceState(state: CircuitState): void {
        this.transition(state);
        if (state === "CLOSED") {
            this.resetStats();
        }
    }
}

/**
 * Circuit Breaker Error
 */
export class CircuitBreakerError extends Error {
    constructor(
        message: string,
        public readonly circuitName: string,
        public readonly state: CircuitState
    ) {
        super(message);
        this.name = "CircuitBreakerError";
    }
}

/**
 * Pre-configured circuit breakers for common services
 */
export const CircuitBreakers = {
    /**
     * Stripe API circuit breaker
     */
    stripe: () => new CircuitBreaker({
        name: "stripe",
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 30000,  // 30 seconds
        onStateChange: (from, to, name) => {
            if (to === "OPEN") {
                console.error(`[ALERT] ${name} circuit breaker opened!`);
            }
        }
    }),

    /**
     * OpenAI API circuit breaker
     */
    openai: () => new CircuitBreaker({
        name: "openai",
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 60000,  // 60 seconds
    }),

    /**
     * Database circuit breaker
     */
    database: () => new CircuitBreaker({
        name: "database",
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 10000,  // 10 seconds
    })
};
