import { randomUUID } from "crypto";
import { LedgerEvent, LedgerEventType } from "./types";

export function createLedgerEvent(input: {
  org_id: string;
  user_id: string;
  project_id: string;
  run_id?: string | null;
  plan_id?: string | null;
  task_id?: string | null;
  event_type: LedgerEventType;
  payload?: Record<string, unknown>;
  ts?: string;
  event_id?: string;
}): LedgerEvent {
  return {
    event_id: input.event_id ?? randomUUID(),
    ts: input.ts ?? new Date().toISOString(),
    org_id: input.org_id,
    user_id: input.user_id,
    project_id: input.project_id,
    run_id: input.run_id ?? null,
    plan_id: input.plan_id ?? null,
    task_id: input.task_id ?? null,
    event_type: input.event_type,
    payload: input.payload ?? {}
  };
}
