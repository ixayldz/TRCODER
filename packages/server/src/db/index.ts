import fs from "fs";
import path from "path";
import initSqlJs, { Database } from "sql.js";
import { createPgDb } from "./pg-db";

export type DbDriver = "sqljs" | "postgres";

// Async database interface (used for both sql.js and postgres)
export interface IDb {
  migrate(): Promise<void>;
  close(): Promise<void>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  healthCheck?(): Promise<{ healthy: boolean; latencyMs: number }>;
}

export type IDbAsync = IDb;

export class SqlJsDb implements IDb {
  private db: Database;
  private persistPath?: string;
  private persistTimer?: NodeJS.Timeout;
  private persistInFlight: Promise<void> | null = null;
  private inTransactionDepth = 0;
  private persistPendingAfterTx = false;

  private constructor(db: Database, persistPath?: string) {
    this.db = db;
    this.persistPath = persistPath;
  }

  static async create(persistPath?: string): Promise<SqlJsDb> {
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    const SQL = await initSqlJs({ locateFile: () => wasmPath });

    let db: Database;
    if (persistPath && fs.existsSync(persistPath)) {
      const buffer = fs.readFileSync(persistPath);
      db = new SQL.Database(new Uint8Array(buffer));
    } else {
      db = new SQL.Database();
    }

    return new SqlJsDb(db, persistPath);
  }

  private schedulePersist(): void {
    if (!this.persistPath) return;
    if (this.inTransactionDepth > 0) {
      this.persistPendingAfterTx = true;
      return;
    }
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persistNow();
    }, 150);
  }

  private async persistNow(): Promise<void> {
    if (!this.persistPath) return;
    if (this.inTransactionDepth > 0) {
      this.persistPendingAfterTx = true;
      return;
    }

    const doPersist = async () => {
      const data = this.db.export();
      fs.mkdirSync(path.dirname(this.persistPath!), { recursive: true });
      fs.writeFileSync(this.persistPath!, Buffer.from(data));
    };

    // Serialize exports; they are synchronous and can be expensive on larger DBs.
    const prev = this.persistInFlight ?? Promise.resolve();
    const next = prev.then(doPersist);
    this.persistInFlight = next.finally(() => {
      if (this.persistInFlight === next) {
        // Avoid holding onto already-settled promises.
        this.persistInFlight = null;
      }
    });
    await this.persistInFlight;
  }

  async migrate(): Promise<void> {
    await this.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        repo_name TEXT,
        repo_root_hash TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        created_at TEXT,
        approved_at TEXT,
        repo_commit TEXT,
        artifacts_json TEXT,
        tasks_json TEXT,
        input_json TEXT
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        plan_id TEXT,
        state TEXT,
        lane TEXT,
        risk TEXT,
        budget_cap_usd REAL,
        cost_to_date REAL,
        current_task_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        plan_task_id TEXT,
        title TEXT,
        type TEXT,
        risk TEXT,
        state TEXT,
        router_decision_json TEXT,
        patch_path TEXT,
        patch_text TEXT,
        cost_usd REAL,
        tokens_in INTEGER,
        tokens_out INTEGER
      );

      CREATE TABLE IF NOT EXISTS ledger_events (
        event_id TEXT PRIMARY KEY,
        ts TEXT,
        org_id TEXT,
        user_id TEXT,
        project_id TEXT,
        run_id TEXT,
        plan_id TEXT,
        task_id TEXT,
        event_type TEXT,
        payload_json TEXT
      );

      CREATE TABLE IF NOT EXISTS context_packs (
        pack_id TEXT PRIMARY KEY,
        project_id TEXT,
        run_id TEXT,
        task_id TEXT,
        manifest_json TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT,
        plan_id TEXT,
        created_at TEXT
      );
    `);
  }

  async close(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    if (this.persistPath) {
      await this.persistNow();
    }
    this.db.close();
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    if (params && params.length > 0) {
      this.db.run(sql, params as any[]);
      this.schedulePersist();
      return;
    }
    this.db.run(sql);
    this.schedulePersist();
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params as any[]);
    }
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.inTransactionDepth += 1;
    await this.exec("BEGIN");
    try {
      const result = await fn();
      await this.exec("COMMIT");
      return result;
    } catch (err) {
      await this.exec("ROLLBACK");
      throw err;
    } finally {
      this.inTransactionDepth = Math.max(0, this.inTransactionDepth - 1);
      if (this.inTransactionDepth === 0 && this.persistPendingAfterTx) {
        this.persistPendingAfterTx = false;
        this.schedulePersist();
      }
    }
  }
}

export { PgDb, createPgDb, PgDbOptions } from "./pg-db";

function resolveDriver(raw?: string): DbDriver {
  const value = (raw ?? "").toLowerCase();
  if (value === "postgres") return "postgres";
  return "sqljs";
}

async function ensureDevKey(db: IDb): Promise<void> {
  const hasDevKey = (await db.query("SELECT key FROM api_keys WHERE key = ?", ["dev"]))[0];
  if (!hasDevKey) {
    await db.exec(
      "INSERT INTO api_keys (key, org_id, user_id, plan_id, created_at) VALUES (?, ?, ?, ?, ?)",
      ["dev", "org_demo", "user_demo", "pro_solo", new Date().toISOString()]
    );
  }
}

export async function createDb(pathOverride?: string): Promise<IDb> {
  const driver = resolveDriver(process.env.TRCODER_DB_DRIVER);
  if (driver === "postgres") {
    const db = await createPgDb();
    await ensureDevKey(db);
    return db;
  }

  const dbPath = pathOverride || process.env.TRCODER_DB_PATH;
  const db = await SqlJsDb.create(dbPath && dbPath !== ":memory:" ? dbPath : undefined);
  await db.migrate();
  await ensureDevKey(db);
  return db;
}
