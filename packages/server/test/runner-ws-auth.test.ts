import { describe, expect, it, afterAll } from "vitest";
import { startServer, stopServer } from "./helpers";
import { WebSocket } from "ws";

let app: Awaited<ReturnType<typeof startServer>>["app"];
let baseUrl = "";

async function setup() {
  process.env.TRCODER_DB_DRIVER = "sqljs";
  process.env.TRCODER_DB_PATH = ":memory:";
  const started = await startServer();
  app = started.app;
  baseUrl = started.baseUrl;
}

afterAll(async () => {
  if (app) {
    await stopServer(app);
  }
  delete process.env.TRCODER_DB_DRIVER;
  delete process.env.TRCODER_DB_PATH;
});

describe("runner ws auth", () => {
  it("rejects unauthorized ws connections and logs ledger event", async () => {
    await setup();
    const ws = new WebSocket(baseUrl.replace("http", "ws") + "/v1/runner/ws");

    await new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
      ws.on("error", () => resolve());
    });

    const ledgerRes = await fetch(`${baseUrl}/v1/ledger/export`, {
      headers: { Authorization: "Bearer dev" }
    });
    const ledgerText = await ledgerRes.text();
    const events = ledgerText
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).event_type as string);

    expect(events).toContain("RUNNER_AUTH_FAILED");
  }, 20000);
});
