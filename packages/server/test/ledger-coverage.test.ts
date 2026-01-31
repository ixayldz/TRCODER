import { describe, expect, it, afterAll } from "vitest";
import {
  startServer,
  stopServer,
  authHeaders,
  connectProject,
  connectRunner
} from "./helpers";

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

describe("ledger coverage", () => {
  it("records canonical events for plan/run/verify", async () => {
    await setup();
    const projectId = await connectProject(baseUrl);

    const { ws, ready } = connectRunner(baseUrl, projectId, (msg) => {
      if (String(msg.cmd).startsWith("git rev-parse")) {
        return { exit_code: 0, stdout: "DEV" };
      }
      if (String(msg.cmd).startsWith("git status --porcelain")) {
        return { exit_code: 0, stdout: "" };
      }
      if (String(msg.cmd).startsWith("git diff --stat")) {
        return { exit_code: 0, stdout: "" };
      }
      return { exit_code: 0, stdout: "ok" };
    });
    await ready;

    const planRes = await fetch(`${baseUrl}/v1/projects/${projectId}/plan`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const planData = await planRes.json();

    await fetch(`${baseUrl}/v1/projects/${projectId}/plan/approve`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ plan_id: planData.plan_id, repo_commit: "DEV" })
    });

    await fetch(`${baseUrl}/v1/projects/${projectId}/plan/status`, {
      headers: { Authorization: "Bearer dev" }
    });

    const runRes = await fetch(`${baseUrl}/v1/projects/${projectId}/runs/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    expect(runRes.status).toBe(200);
    const runData = await runRes.json();
    expect(runData.run_id).toBeTruthy();

    await fetch(`${baseUrl}/v1/runs/${runData.run_id}/verify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "targeted" })
    });

    const pauseRes = await fetch(`${baseUrl}/v1/runs/${runData.run_id}/pause`, {
      method: "POST",
      headers: { Authorization: "Bearer dev" }
    });
    expect(pauseRes.status).toBe(200);
    const resumeRes = await fetch(`${baseUrl}/v1/runs/${runData.run_id}/resume`, {
      method: "POST",
      headers: { Authorization: "Bearer dev" }
    });
    expect(resumeRes.status).toBe(200);
    const cancelRes = await fetch(`${baseUrl}/v1/runs/${runData.run_id}/cancel`, {
      method: "POST",
      headers: { Authorization: "Bearer dev" }
    });
    expect(cancelRes.status).toBe(200);

    const ledgerRes = await fetch(`${baseUrl}/v1/ledger/export`, {
      headers: { Authorization: "Bearer dev" }
    });
    const ledgerText = await ledgerRes.text();
    const eventTypes = ledgerText
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).event_type as string);

    const required = [
      "RUN_STARTED",
      "RUN_COMPLETED",
      "PLAN_CREATED",
      "PLAN_APPROVED",
      "PLAN_STATUS",
      "TASK_STARTED",
      "TASK_STAGE",
      "TASK_COMPLETED",
      "ROUTER_DECISION",
      "CONTEXT_PACK_BUILT",
      "LLM_CALL_STARTED",
      "LLM_CALL_FINISHED",
      "PATCH_PRODUCED",
      "VERIFY_STARTED",
      "VERIFY_FINISHED",
      "BILLING_POSTED",
      "RUN_PAUSED",
      "RUN_RESUMED",
      "RUN_CANCELLED"
    ];

    for (const event of required) {
      expect(eventTypes).toContain(event);
    }

    await new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
      ws.close();
    });
  }, 20000);
});
