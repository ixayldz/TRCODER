import { Pool, PoolConfig } from "pg";
import { IDb } from "./index";

const MIGRATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    repo_name TEXT,
    repo_root_hash TEXT,
    created_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    created_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    repo_commit TEXT,
    artifacts_json JSONB,
    tasks_json JSONB,
    input_json JSONB
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    plan_id TEXT REFERENCES plans(id),
    state TEXT,
    lane TEXT,
    risk TEXT,
    budget_cap_usd NUMERIC(10, 4),
    cost_to_date NUMERIC(10, 4),
    current_task_id TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id),
    plan_task_id TEXT,
    title TEXT,
    type TEXT,
    risk TEXT,
    state TEXT,
    router_decision_json JSONB,
    patch_path TEXT,
    patch_text TEXT,
    cost_usd NUMERIC(10, 4),
    tokens_in INTEGER,
    tokens_out INTEGER
  );

  CREATE TABLE IF NOT EXISTS ledger_events (
    event_id TEXT PRIMARY KEY,
    ts TIMESTAMPTZ,
    org_id TEXT,
    user_id TEXT,
    project_id TEXT,
    run_id TEXT,
    plan_id TEXT,
    task_id TEXT,
    event_type TEXT,
    payload_json JSONB
  );

  CREATE INDEX IF NOT EXISTS idx_ledger_events_ts ON ledger_events(ts);
  CREATE INDEX IF NOT EXISTS idx_ledger_events_run ON ledger_events(run_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_events_type ON ledger_events(event_type);

  CREATE TABLE IF NOT EXISTS context_packs (
    pack_id TEXT PRIMARY KEY,
    project_id TEXT,
    run_id TEXT,
    task_id TEXT,
    manifest_json JSONB,
    created_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    org_id TEXT,
    user_id TEXT,
    plan_id TEXT,
    created_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
`;

export interface PgDbOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

function buildPoolConfig(options: PgDbOptions): PoolConfig {
  const config: PoolConfig = {
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5000
  };

  if (options.connectionString) {
    config.connectionString = options.connectionString;
  } else {
    config.host = options.host ?? "localhost";
    config.port = options.port ?? 5432;
    config.database = options.database ?? "trcoder";
    config.user = options.user ?? "postgres";
    config.password = options.password;
  }

  if (options.ssl !== undefined) {
    config.ssl = options.ssl;
  }

  return config;
}

function normalizeSql(sql: string, params?: unknown[]): string {
  if (!params || params.length === 0 || !sql.includes("?")) return sql;
  let idx = 0;
  return sql.replace(/\?/g, () => `$${(idx += 1)}`);
}

export class PgDb implements IDb {
  private pool: Pool;
  private migrated = false;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  static async create(options: PgDbOptions): Promise<PgDb> {
    const config = buildPoolConfig(options);
    const pool = new Pool(config);

    // Test connection
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }

    return new PgDb(pool);
  }

  static fromEnv(): Promise<PgDb> {
    const options: PgDbOptions = {};

    if (process.env.TRCODER_DB_URL) {
      options.connectionString = process.env.TRCODER_DB_URL;
    } else {
      options.host = process.env.TRCODER_DB_HOST ?? "localhost";
      options.port = parseInt(process.env.TRCODER_DB_PORT ?? "5432", 10);
      options.database = process.env.TRCODER_DB_NAME ?? "trcoder";
      options.user = process.env.TRCODER_DB_USER ?? "postgres";
      options.password = process.env.TRCODER_DB_PASSWORD;
    }

    if (process.env.TRCODER_DB_SSL === "true") {
      options.ssl = { rejectUnauthorized: false };
    }

    if (process.env.TRCODER_DB_MAX_CONNECTIONS) {
      options.maxConnections = parseInt(process.env.TRCODER_DB_MAX_CONNECTIONS, 10);
    }

    return PgDb.create(options);
  }

  async migrate(): Promise<void> {
    if (this.migrated) return;

    const client = await this.pool.connect();
    try {
      await client.query(MIGRATION_SCHEMA);
      this.migrated = true;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      const normalized = normalizeSql(sql, params);
      if (params && params.length > 0) {
        await client.query(normalized, params);
      } else {
        await client.query(normalized);
      }
    } finally {
      client.release();
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const normalized = normalizeSql(sql, params);
      const result = params && params.length > 0
        ? await client.query(normalized, params)
        : await client.query(normalized);
      return result.rows as T[];
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; poolSize: number; idleCount: number }> {
    const start = Date.now();
    try {
      const client = await this.pool.connect();
      try {
        await client.query("SELECT 1");
        return {
          healthy: true,
          latencyMs: Date.now() - start,
          poolSize: this.pool.totalCount,
          idleCount: this.pool.idleCount
        };
      } finally {
        client.release();
      }
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        poolSize: this.pool.totalCount,
        idleCount: this.pool.idleCount
      };
    }
  }

  getPool(): Pool {
    return this.pool;
  }
}

export async function createPgDb(options?: PgDbOptions): Promise<PgDb> {
  const db = options ? await PgDb.create(options) : await PgDb.fromEnv();
  await db.migrate();
  return db;
}
