/**
 * Structured Logging with Pino-compatible format
 * 
 * Production-ready logging with levels, correlation IDs, and JSON output
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVELS: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60
};

interface LogContext {
    correlationId?: string;
    requestId?: string;
    userId?: string;
    orgId?: string;
    projectId?: string;
    runId?: string;
    taskId?: string;
    [key: string]: unknown;
}

interface LogEntry {
    level: number;
    time: number;
    msg: string;
    pid: number;
    hostname: string;
    [key: string]: unknown;
}

export interface LoggerOptions {
    level?: LogLevel;
    name?: string;
    prettyPrint?: boolean;
    redact?: string[];
}

export class Logger {
    private level: number;
    private name: string;
    private prettyPrint: boolean;
    private redactPaths: Set<string>;
    private context: LogContext = {};
    private hostname: string;
    private pid: number;

    constructor(options: LoggerOptions = {}) {
        this.level = LOG_LEVELS[options.level ?? (process.env.TRCODER_LOG_LEVEL as LogLevel) ?? "info"];
        this.name = options.name ?? "trcoder";
        this.prettyPrint = options.prettyPrint ?? process.env.NODE_ENV !== "production";
        this.redactPaths = new Set(options.redact ?? ["password", "api_key", "apiKey", "token", "secret"]);
        this.hostname = process.env.HOSTNAME ?? "localhost";
        this.pid = process.pid;
    }

    child(context: LogContext): Logger {
        const child = new Logger({
            level: Object.keys(LOG_LEVELS).find((k) => LOG_LEVELS[k as LogLevel] === this.level) as LogLevel,
            name: this.name,
            prettyPrint: this.prettyPrint,
            redact: Array.from(this.redactPaths)
        });
        child.context = { ...this.context, ...context };
        return child;
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] >= this.level;
    }

    private redact(obj: Record<string, unknown>): Record<string, unknown> {
        const redacted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            if (this.redactPaths.has(key.toLowerCase())) {
                redacted[key] = "[REDACTED]";
            } else if (typeof value === "object" && value !== null) {
                redacted[key] = this.redact(value as Record<string, unknown>);
            } else {
                redacted[key] = value;
            }
        }
        return redacted;
    }

    private formatPretty(entry: LogEntry): string {
        const levelName = Object.keys(LOG_LEVELS).find((k) => LOG_LEVELS[k as LogLevel] === entry.level) ?? "info";
        const time = new Date(entry.time).toISOString();
        const color = this.getLevelColor(levelName as LogLevel);

        let msg = `${time} ${color}${levelName.toUpperCase().padEnd(5)}${"\x1b[0m"} [${this.name}] ${entry.msg}`;

        const extra: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(entry)) {
            if (!["level", "time", "msg", "pid", "hostname", "name"].includes(k)) {
                extra[k] = v;
            }
        }

        if (Object.keys(extra).length > 0) {
            msg += ` ${JSON.stringify(extra)}`;
        }

        return msg;
    }

    private getLevelColor(level: LogLevel): string {
        const colors: Record<LogLevel, string> = {
            trace: "\x1b[90m",
            debug: "\x1b[36m",
            info: "\x1b[32m",
            warn: "\x1b[33m",
            error: "\x1b[31m",
            fatal: "\x1b[35m"
        };
        return colors[level];
    }

    private log(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
        if (!this.shouldLog(level)) return;

        const entry: LogEntry = {
            level: LOG_LEVELS[level],
            time: Date.now(),
            msg,
            pid: this.pid,
            hostname: this.hostname,
            name: this.name,
            ...this.context,
            ...(context ? this.redact(context) : {})
        };

        const output = this.prettyPrint ? this.formatPretty(entry) : JSON.stringify(entry);

        if (level === "error" || level === "fatal") {
            console.error(output);
        } else {
            console.log(output);
        }
    }

    trace(msg: string, context?: Record<string, unknown>): void {
        this.log("trace", msg, context);
    }

    debug(msg: string, context?: Record<string, unknown>): void {
        this.log("debug", msg, context);
    }

    info(msg: string, context?: Record<string, unknown>): void {
        this.log("info", msg, context);
    }

    warn(msg: string, context?: Record<string, unknown>): void {
        this.log("warn", msg, context);
    }

    error(msg: string, context?: Record<string, unknown>): void {
        this.log("error", msg, context);
    }

    fatal(msg: string, context?: Record<string, unknown>): void {
        this.log("fatal", msg, context);
    }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function getLogger(options?: LoggerOptions): Logger {
    if (!globalLogger) {
        globalLogger = new Logger(options);
    }
    return globalLogger;
}

export function setLogger(logger: Logger): void {
    globalLogger = logger;
}

/**
 * Request logging middleware for Fastify
 */
export function createRequestLogger(logger: Logger) {
    return {
        onRequest: (request: { id: string; method: string; url: string }, _reply: unknown, done: () => void) => {
            const reqLogger = logger.child({ requestId: request.id });
            reqLogger.info("Request started", {
                method: request.method,
                url: request.url
            });
            done();
        },
        onResponse: (request: { id: string; method: string; url: string }, reply: { statusCode: number }, done: () => void) => {
            const reqLogger = logger.child({ requestId: request.id });
            reqLogger.info("Request completed", {
                method: request.method,
                url: request.url,
                statusCode: reply.statusCode
            });
            done();
        }
    };
}

/**
 * Correlation ID generator
 */
export function generateCorrelationId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
