import { LedgerEvent } from "@trcoder/shared";
import { IDb } from "./db";
import { parseJsonValue } from "./utils/json";

export async function appendLedgerEvent(db: IDb, event: LedgerEvent): Promise<void> {
  await db.exec(
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

export async function listLedgerEvents(
  db: IDb,
  startTs: string,
  endTs: string
): Promise<LedgerEvent[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT event_id, ts, org_id, user_id, project_id, run_id, plan_id, task_id, event_type, payload_json FROM ledger_events WHERE ts >= ? AND ts < ? ORDER BY ts ASC",
    [startTs, endTs]
  );

  return rows.map((row) => ({
    event_id: String(row.event_id),
    ts: String(row.ts),
    org_id: String(row.org_id),
    user_id: String(row.user_id),
    project_id: String(row.project_id),
    run_id: row.run_id as string | null | undefined,
    plan_id: row.plan_id as string | null | undefined,
    task_id: row.task_id as string | null | undefined,
    event_type: row.event_type as LedgerEvent["event_type"],
    payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {})
  }));
}
