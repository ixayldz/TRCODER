import { createServer } from "../src/server";
import { WebSocket } from "ws";

export async function startServer(): Promise<{
  app: Awaited<ReturnType<typeof createServer>>["app"];
  baseUrl: string;
}> {
  const { app } = await createServer();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind server");
  }
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

export async function stopServer(app: Awaited<ReturnType<typeof createServer>>["app"]) {
  await app.close();
}

export function authHeaders() {
  return { Authorization: "Bearer dev", "Content-Type": "application/json" };
}

export async function connectProject(baseUrl: string): Promise<string> {
  const projectRes = await fetch(`${baseUrl}/v1/projects/connect`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ repo_name: "trcoder", repo_root_hash: "DEV" })
  });
  const projectData = await projectRes.json();
  return projectData.project_id as string;
}

export function connectRunner(
  baseUrl: string,
  projectId: string,
  onExec: (msg: any) => {
    exit_code: number;
    stdout?: string;
    stderr?: string;
    duration_ms?: number;
  }
): { ws: WebSocket; ready: Promise<string> } {
  const ws = new WebSocket(baseUrl.replace("http", "ws") + "/v1/runner/ws", {
    headers: {
      Authorization: "Bearer dev",
      "X-TRCODER-Project": projectId
    }
  });
  let sessionId = "";
  const ready = new Promise<string>((resolve) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "HELLO_ACK") {
        sessionId = msg.runner_session_id;
        resolve(sessionId);
      }
      if (msg.type === "RUNNER_EXEC") {
        const result = onExec(msg);
        ws.send(
          JSON.stringify({
            type: "RUNNER_RESULT",
            request_id: msg.request_id,
            runner_session_id: sessionId,
            exit_code: result.exit_code,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
            duration_ms: result.duration_ms ?? 1
          })
        );
      }
    });
  });

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "HELLO", project_id: projectId }));
  });

  return { ws, ready };
}
