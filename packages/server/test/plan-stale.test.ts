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

describe("plan stale rule", () => {
  it("marks stale when dirty and requires confirm for start", async () => {
    await setup();
    const projectId = await connectProject(baseUrl);

    const { ws, ready } = connectRunner(baseUrl, projectId, (msg) => {
      if (String(msg.cmd).startsWith("git rev-parse")) {
        return { exit_code: 0, stdout: "DEV" };
      }
      if (String(msg.cmd).startsWith("git status --porcelain")) {
        return { exit_code: 0, stdout: " M index.ts" };
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

    const statusRes = await fetch(`${baseUrl}/v1/projects/${projectId}/plan/status`, {
      headers: { Authorization: "Bearer dev" }
    });
    const status = await statusRes.json();
    expect(status.stale).toBe(true);
    expect(status.dirty).toBe(true);

    const runRes = await fetch(`${baseUrl}/v1/projects/${projectId}/runs/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    expect(runRes.status).toBe(409);

    const runResOk = await fetch(`${baseUrl}/v1/projects/${projectId}/runs/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ confirm_stale: true })
    });
    expect(runResOk.status).toBe(200);

    ws.close();
  }, 20000);
});
