import fs from "fs";
import path from "path";
import initSqlJs, { Database } from "sql.js";

export interface IDb {
  migrate(): void;
  close(): void;
  exec(sql: string, params?: unknown[]): void;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  transaction<T>(fn: () => T): T;
}

export class SqlJsDb implements IDb {
  private db: Database;
  private persistPath?: string;

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

  migrate(): void {
    this.exec(`
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

  close(): void {
    if (this.persistPath) {
      const data = this.db.export();
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, Buffer.from(data));
    }
    this.db.close();
  }

  exec(sql: string, params?: unknown[]): void {
    if (params && params.length > 0) {
      this.db.run(sql, params as any[]);
      return;
    }
    this.db.run(sql);
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
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

  transaction<T>(fn: () => T): T {
    this.exec("BEGIN");
    try {
      const result = fn();
      this.exec("COMMIT");
      return result;
    } catch (err) {
      this.exec("ROLLBACK");
      throw err;
    }
  }
}

export class PostgresDb implements IDb {
  migrate(): void {
    throw new Error("PostgresDb not implemented");
  }
  close(): void {
    throw new Error("PostgresDb not implemented");
  }
  exec(): void {
    throw new Error("PostgresDb not implemented");
  }
  query(): any[] {
    throw new Error("PostgresDb not implemented");
  }
  transaction<T>(): T {
    throw new Error("PostgresDb not implemented");
  }
}

export async function createDb(pathOverride?: string): Promise<IDb> {
  const driver = (process.env.TRCODER_DB_DRIVER ?? "sqljs").toLowerCase();
  if (driver === "postgres") {
    const db = new PostgresDb();
    db.migrate();
    return db;
  }

  const dbPath = pathOverride || process.env.TRCODER_DB_PATH;
  const db = await SqlJsDb.create(dbPath && dbPath !== ":memory:" ? dbPath : undefined);
  db.migrate();

  const hasDevKey = db.query("SELECT key FROM api_keys WHERE key = ?", ["dev"])[0];
  if (!hasDevKey) {
    db.exec(
      "INSERT INTO api_keys (key, org_id, user_id, plan_id, created_at) VALUES (?, ?, ?, ?, ?)",
      ["dev", "org_demo", "user_demo", "pro_solo", new Date().toISOString()]
    );
  }

  return db;
}
