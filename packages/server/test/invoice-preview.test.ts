import { describe, expect, it } from "vitest";
import { createServer } from "../src/server";
import { appendLedgerEvent } from "../src/ledger-store";
import { createLedgerEvent } from "@trcoder/shared";

describe("invoice preview", () => {
  it("computes from ledger events only", async () => {
    process.env.TRCODER_DB_DRIVER = "sqljs";
    process.env.TRCODER_DB_PATH = ":memory:";
    const { app, db } = await createServer();

    appendLedgerEvent(
      db,
      createLedgerEvent({
        org_id: "org_demo",
        user_id: "user_demo",
        project_id: "project_demo",
        run_id: "run_demo",
        event_type: "LLM_CALL_FINISHED",
        payload: {
          model: "claude-sonnet-4.5",
          task_type: "backend_development",
          provider_cost_usd: 2,
          credits_applied_usd: 1,
          billable_provider_cost_usd: 1,
          markup_rate: 0.3,
          our_charge_usd: 1.3
        }
      })
    );

    appendLedgerEvent(
      db,
      createLedgerEvent({
        org_id: "org_demo",
        user_id: "user_demo",
        project_id: "project_demo",
        run_id: "run_demo",
        event_type: "LLM_CALL_FINISHED",
        payload: {
          model: "claude-sonnet-4.5",
          task_type: "backend_development",
          provider_cost_usd: 3,
          credits_applied_usd: 0,
          billable_provider_cost_usd: 3,
          markup_rate: 0.3,
          our_charge_usd: 3.9
        }
      })
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/invoice/preview",
      headers: { Authorization: "Bearer dev" }
    });
    const payload = res.json();

    expect(payload.usage.provider_cost_total).toBeCloseTo(5);
    expect(payload.usage.credits_used).toBeCloseTo(1);
    expect(payload.usage.billable_provider_cost_total).toBeCloseTo(4);
    expect(payload.usage.charged_total).toBeCloseTo(5.2);
    expect(payload.subtotal_usd).toBeCloseTo(payload.monthly_price_usd + payload.usage.charged_total);

    await app.close();
    delete process.env.TRCODER_DB_DRIVER;
    delete process.env.TRCODER_DB_PATH;
  });
});
