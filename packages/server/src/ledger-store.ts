import { LedgerEvent } from "@trcoder/shared";
import { IDb } from "./db";

export function appendLedgerEvent(db: IDb, event: LedgerEvent): void {
  db.exec(
    "INSERT INTO ledger_events (event_id, ts, org_id, user_id, project_id, run_id, plan_id, task_id, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      event.event_id,
      event.ts,
      event.org_id,
      event.user_id,
      event.project_id,
      event.run_id ?? null,
      event.plan_id ?? null,
      event.task_id ?? null,
      event.event_type,
      JSON.stringify(event.payload ?? {})
    ]
  );
}

export function listLedgerEvents(db: IDb, startTs: string, endTs: string): LedgerEvent[] {
  const rows = db.query<Record<string, string>>(
    "SELECT event_id, ts, org_id, user_id, project_id, run_id, plan_id, task_id, event_type, payload_json FROM ledger_events WHERE ts >= ? AND ts < ? ORDER BY ts ASC",
    [startTs, endTs]
  );

  return rows.map((row) => ({
    event_id: row.event_id,
    ts: row.ts,
    org_id: row.org_id,
    user_id: row.user_id,
    project_id: row.project_id,
    run_id: row.run_id,
    plan_id: row.plan_id,
    task_id: row.task_id,
    event_type: row.event_type as LedgerEvent["event_type"],
    payload: JSON.parse(row.payload_json || "{}") as Record<string, unknown>
  }));
}
