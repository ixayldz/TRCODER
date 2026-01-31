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

async function collectStages(runId: string, required: string[], timeoutMs = 8000): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const stages = new Set<string>();

  try {
    const res = await fetch(`${baseUrl}/v1/runs/${runId}/stream`, {
      headers: { Authorization: "Bearer dev" },
      signal: controller.signal
    });
    const reader = res.body?.getReader();
    if (!reader) return [];
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const raw = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        const line = raw.split("\n").find((l) => l.startsWith("data:"));
        if (!line) {
          idx = buffer.indexOf("\n\n");
          continue;
        }
        const dataStr = line.replace(/^data:\s?/, "");
        const parsed = JSON.parse(dataStr);
        if (parsed.type === "TASK_STAGE") {
          stages.add(parsed.data?.stage);
        }
        if (required.every((stage) => stages.has(stage))) {
          controller.abort();
          return Array.from(stages);
        }
        idx = buffer.indexOf("\n\n");
      }
    }
    return Array.from(stages);
  } catch {
    return Array.from(stages);
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
}

describe("sse stage coverage", () => {
  it("emits canonical task stages", async () => {
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

    const runRes = await fetch(`${baseUrl}/v1/projects/${projectId}/runs/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const runData = await runRes.json();

    const requiredStages = [
      "PREPARE_CONTEXT",
      "DESIGN",
      "IMPLEMENT_PATCH",
      "LOCAL_VERIFY",
      "SELF_REVIEW",
      "PROPOSE_APPLY"
    ];

    const stagesPromise = collectStages(runData.run_id, requiredStages, 12000);

    await fetch(`${baseUrl}/v1/runs/${runData.run_id}/verify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "targeted" })
    });

    const stages = await stagesPromise;
    for (const stage of requiredStages) {
      expect(stages).toContain(stage);
    }

    ws.close();
  }, 20000);
});
