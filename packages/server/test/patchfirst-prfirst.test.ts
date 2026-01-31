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

describe("patch-first / pr-first", () => {
  it("does not execute write commands during /start", async () => {
    await setup();
    const projectId = await connectProject(baseUrl);
    const commands: string[] = [];
    const { ws, ready } = connectRunner(baseUrl, projectId, (msg) => {
      const cmd = String(msg.cmd ?? "");
      commands.push(cmd);
      if (cmd.startsWith("git rev-parse")) {
        return { exit_code: 0, stdout: "DEV" };
      }
      if (cmd.startsWith("git status --porcelain")) {
        return { exit_code: 0, stdout: "" };
      }
      if (cmd.startsWith("git diff --stat")) {
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

    const runRes = await fetch(`${baseUrl}/v1/projects/${projectId}/runs/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    expect(runRes.status).toBe(200);

    const forbidden = commands.filter((cmd) =>
      /git\s+(apply|commit|push|checkout|merge)|rm\s+-rf|mv\s+|cp\s+/i.test(cmd)
    );
    expect(forbidden).toEqual([]);

    ws.close();
  }, 20000);
});
