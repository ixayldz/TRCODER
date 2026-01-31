import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { appendLedgerEvent } from "../src/ledger-store";
import { createLedgerEvent } from "@trcoder/shared";


describe("ledger append-only", () => {
  it("rejects duplicate event ids", async () => {
    const db = await createDb();
    const event = createLedgerEvent({
      org_id: "org",
      user_id: "user",
      project_id: "project",
      event_type: "RUN_STARTED"
    });
    appendLedgerEvent(db, event);

    let threw = false;
    try {
      appendLedgerEvent(db, event);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    db.close();
  });
});
