import { describe, expect, it, afterAll } from "vitest";
import { createServer } from "../src/server";
import { WebSocket } from "ws";

let app: Awaited<ReturnType<typeof createServer>>["app"]; 
let baseUrl = "";

async function startServer() {
  const { app: server } = await createServer();
  await server.listen({ port: 0, host: "127.0.0.1" });
  const address = server.server.address();
  if (typeof address === "string" || !address) {
    throw new Error("Failed to bind server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  app = server;
}

async function stopServer() {
  await app.close();
}

function authHeaders() {
  return { Authorization: "Bearer dev", "Content-Type": "application/json" };
}

async function collectSseEvents(runId: string, types: string[], timeoutMs = 8000): Promise<any[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const collected: any[] = [];
  try {
    const res = await fetch(`${baseUrl}/v1/runs/${runId}/stream`, {
      headers: { Authorization: "Bearer dev" },
      signal: controller.signal
    });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no stream");

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
        collected.push(parsed);
        if (types.every((t) => collected.some((evt) => evt.type === t))) {
          controller.abort();
          return collected;
        }
        idx = buffer.indexOf("\n\n");
      }
    }
    return collected;
  } catch {
    return collected;
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
}

describe("integration smoke", () => {
  it("runs plan/start/verify with runner ws", async () => {
    process.env.TRCODER_DB_DRIVER = "sqljs";
    process.env.TRCODER_DB_PATH = ":memory:";
    await startServer();

    const projectRes = await fetch(`${baseUrl}/v1/projects/connect`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ repo_name: "trcoder", repo_root_hash: "DEV" })
    });
    const projectData = await projectRes.json();

    const ws = new WebSocket(baseUrl.replace("http", "ws") + "/v1/runner/ws", {
      headers: {
        Authorization: "Bearer dev",
        "X-TRCODER-Project": projectData.project_id
      }
    });
    let sessionId = "";
    ws.on("open", () => {
      ws.send(
        JSON.stringify({ type: "HELLO", project_id: projectData.project_id })
      );
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "HELLO_ACK") {
        sessionId = msg.runner_session_id;
      }
      if (msg.type === "RUNNER_EXEC") {
        ws.send(
          JSON.stringify({
            type: "RUNNER_RESULT",
            request_id: msg.request_id,
            runner_session_id: sessionId,
            exit_code: 0,
            stdout: "ok",
            stderr: "",
            duration_ms: 1
          })
        );
      }
    });

    const planRes = await fetch(`${baseUrl}/v1/projects/${projectData.project_id}/plan`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const planData = await planRes.json();

    await fetch(`${baseUrl}/v1/projects/${projectData.project_id}/plan/approve`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ plan_id: planData.plan_id, repo_commit: "DEV" })
    });

    const runRes = await fetch(`${baseUrl}/v1/projects/${projectData.project_id}/runs/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const runData = await runRes.json();

    const events = await collectSseEvents(runData.run_id, [
      "RUN_BANNER",
      "TASK_STARTED",
      "TASK_STAGE",
      "SESSION_STATS"
    ]);
    expect(events.some((event) => event.type === "RUN_BANNER")).toBe(true);
    const stages = events
      .filter((event) => event.type === "TASK_STAGE")
      .map((event) => event.data?.stage);
    expect(stages).toContain("SELF_REVIEW");
    expect(stages).toContain("PROPOSE_APPLY");

    const taskStarted = events.find((event) => event.type === "TASK_STARTED");
    const packId = taskStarted?.data?.context_pack?.id;
    expect(packId).toBeTruthy();

    const statsRes = await fetch(`${baseUrl}/v1/packs/${packId}/stats`, {
      headers: { Authorization: "Bearer dev" }
    });
    const stats = await statsRes.json();
    expect(stats.pack_id).toBe(packId);

    const rebuildRes = await fetch(`${baseUrl}/v1/packs/${packId}/rebuild`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ budgets: { max_files: 50, max_lines: 2000, graph_depth: 2, top_k: 16, hydrate: false } })
    });
    const rebuild = await rebuildRes.json();
    expect(rebuild.new_pack_id).toBeTruthy();

    const verifyRes = await fetch(`${baseUrl}/v1/runs/${runData.run_id}/verify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "targeted" })
    });
    const verifyData = await verifyRes.json();
    expect(verifyData.status).toBe("pass");

    ws.close();
    await stopServer();
    delete process.env.TRCODER_DB_DRIVER;
    delete process.env.TRCODER_DB_PATH;
  }, 20000);
});
