import { describe, expect, it } from "vitest";
import { createServer } from "../src/server";
import { appendLedgerEvent } from "../src/ledger-store";
import { createLedgerEvent } from "@trcoder/shared";

describe("usage endpoints", () => {
  it("reflects ledger totals for today and month", async () => {
    process.env.TRCODER_DB_DRIVER = "sqljs";
    process.env.TRCODER_DB_PATH = ":memory:";
    const { app, db } = await createServer();

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await appendLedgerEvent(
      db,
      createLedgerEvent({
        org_id: "org_demo",
        user_id: "user_demo",
        project_id: "project_demo",
        run_id: "run_demo",
        event_type: "LLM_CALL_FINISHED",
        ts: now.toISOString(),
        payload: {
          model: "claude-sonnet-4.5",
          task_type: "backend_development",
          provider_cost_usd: 1,
          credits_applied_usd: 1,
          billable_provider_cost_usd: 0,
          markup_rate: 0.3,
          our_charge_usd: 0
        }
      })
    );

    await appendLedgerEvent(
      db,
      createLedgerEvent({
        org_id: "org_demo",
        user_id: "user_demo",
        project_id: "project_demo",
        run_id: "run_demo",
        event_type: "LLM_CALL_FINISHED",
        ts: yesterday.toISOString(),
        payload: {
          model: "claude-sonnet-4.5",
          task_type: "backend_development",
          provider_cost_usd: 2,
          credits_applied_usd: 0,
          billable_provider_cost_usd: 2,
          markup_rate: 0.3,
          our_charge_usd: 2.6
        }
      })
    );

    const todayRes = await app.inject({
      method: "GET",
      url: "/v1/usage/today",
      headers: { Authorization: "Bearer dev" }
    });
    const today = todayRes.json();
    expect(today.provider_cost_total).toBeCloseTo(1);
    expect(today.credits_used).toBeCloseTo(1);

    const monthRes = await app.inject({
      method: "GET",
      url: "/v1/usage/month",
      headers: { Authorization: "Bearer dev" }
    });
    const month = monthRes.json();
    expect(month.provider_cost_total).toBeCloseTo(3);
    expect(month.credits_used).toBeCloseTo(1);
    expect(month.charged_total).toBeCloseTo(2.6);

    await app.close();
    delete process.env.TRCODER_DB_DRIVER;
    delete process.env.TRCODER_DB_PATH;
  });
});
