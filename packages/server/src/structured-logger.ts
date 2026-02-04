/**
 * Structured Logger
 * 
 * JSON-based structured logging with log levels, context, and correlation IDs.
 * Supports both console output and external log aggregation.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
    requestId?: string;
    userId?: string;
    orgId?: string;
    runId?: string;
    taskId?: string;
    service?: string;
    [key: string]: unknown;
}

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: LogContext;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
    duration?: number;
    [key: string]: unknown;
}

export interface LoggerConfig {
    level: LogLevel;
    service: string;
    environment?: string;
    pretty?: boolean;           // Pretty print for development
    output?: (entry: LogEntry) => void;  // Custom output handler
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4
};

/**
 * Structured Logger
 */
export class Logger {
    private config: Required<LoggerConfig>;
    private context: LogContext = {};

    constructor(config: LoggerConfig) {
        this.config = {
            environment: process.env.NODE_ENV ?? "development",
            pretty: process.env.NODE_ENV !== "production",
            output: (entry) => this.defaultOutput(entry),
            ...config
        };
    }

    /**
     * Create child logger with additional context
     */
    child(context: LogContext): Logger {
        const child = new Logger(this.config);
        child.context = { ...this.context, ...context };
        return child;
    }

    /**
     * Set context values
     */
    setContext(context: LogContext): void {
        this.context = { ...this.context, ...context };
    }

    /**
     * Log debug message
     */
    debug(message: string, data?: Record<string, unknown>): void {
        this.log("debug", message, data);
    }

    /**
     * Log info message
     */
    info(message: string, data?: Record<string, unknown>): void {
        this.log("info", message, data);
    }

    /**
     * Log warning
     */
    warn(message: string, data?: Record<string, unknown>): void {
        this.log("warn", message, data);
    }

    /**
     * Log error
     */
    error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
        const errorInfo = this.formatError(error);
        this.log("error", message, { ...data, error: errorInfo });
    }

    /**
     * Log fatal error
     */
    fatal(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
        const errorInfo = this.formatError(error);
        this.log("fatal", message, { ...data, error: errorInfo });
    }

    /**
     * Log with timing
     */
    timed<T>(message: string, fn: () => T | Promise<T>, data?: Record<string, unknown>): T | Promise<T> {
        const start = Date.now();

        try {
            const result = fn();

            if (result instanceof Promise) {
                return result.then((value) => {
                    this.info(message, { ...data, duration: Date.now() - start });
                    return value;
                }).catch((err) => {
                    this.error(message, err, { ...data, duration: Date.now() - start });
                    throw err;
                });
            }

            this.info(message, { ...data, duration: Date.now() - start });
            return result;
        } catch (err) {
            this.error(message, err, { ...data, duration: Date.now() - start });
            throw err;
        }
    }

    /**
     * Core log method
     */
    private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
        if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context: {
                service: this.config.service,
                environment: this.config.environment,
                ...this.context
            },
            ...data
        };

        this.config.output(entry);
    }

    /**
     * Format error for logging
     */
    private formatError(error: Error | unknown): LogEntry["error"] | undefined {
        if (!error) return undefined;

        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }

        return {
            name: "UnknownError",
            message: String(error)
        };
    }

    /**
     * Default output handler
     */
    private defaultOutput(entry: LogEntry): void {
        if (this.config.pretty) {
            this.prettyPrint(entry);
        } else {
            console.log(JSON.stringify(entry));
        }
    }

    /**
     * Pretty print for development
     */
    private prettyPrint(entry: LogEntry): void {
        const colors: Record<LogLevel, string> = {
            debug: "\x1b[90m",  // Gray
            info: "\x1b[36m",   // Cyan
            warn: "\x1b[33m",   // Yellow
            error: "\x1b[31m",  // Red
            fatal: "\x1b[35m"   // Magenta
        };
        const reset = "\x1b[0m";
        const color = colors[entry.level];

        const time = entry.timestamp.split("T")[1].replace("Z", "");
        const prefix = `${color}[${entry.level.toUpperCase().padEnd(5)}]${reset}`;
        const contextStr = entry.context?.requestId ? ` (${entry.context.requestId})` : "";

        console.log(`${time} ${prefix} ${entry.message}${contextStr}`);

        if (entry.duration !== undefined) {
            console.log(`  ⏱️  ${entry.duration}ms`);
        }

        if (entry.error) {
            console.log(`  ❌ ${entry.error.name}: ${entry.error.message}`);
            if (entry.error.stack && entry.level === "fatal") {
                console.log(entry.error.stack);
            }
        }
    }
}

/**
 * Create request-scoped logger
 */
export function createRequestLogger(
    baseLogger: Logger,
    request: { headers: Record<string, string | string[] | undefined> }
): Logger {
    const requestId = Array.isArray(request.headers["x-request-id"])
        ? request.headers["x-request-id"][0]
        : request.headers["x-request-id"] ?? generateRequestId();

    return baseLogger.child({ requestId });
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Global logger instance
 */
let globalLogger: Logger | null = null;

export function initLogger(config: LoggerConfig): Logger {
    globalLogger = new Logger(config);
    return globalLogger;
}

export function getLogger(): Logger {
    if (!globalLogger) {
        globalLogger = new Logger({
            level: "info",
            service: "trcoder"
        });
    }
    return globalLogger;
}
