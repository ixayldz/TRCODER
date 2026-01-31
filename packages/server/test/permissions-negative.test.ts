import fs from "fs";
import os from "os";
import path from "path";
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
let tempDir = "";

async function setup() {
  process.env.TRCODER_DB_DRIVER = "sqljs";
  process.env.TRCODER_DB_PATH = ":memory:";

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trcoder-permissions-"));
  const permissionsPath = path.join(tempDir, "permissions.yaml");
  const verifyPath = path.join(tempDir, "verify.yaml");

  fs.writeFileSync(
    permissionsPath,
    [
      "version: permissions.defaults.v1",
      "",
      "allow:",
      "  - \"git rev-parse HEAD\"",
      "  - \"git status --porcelain\"",
      "  - \"git diff --stat\"",
      "  - \"echo allow\"",
      "",
      "ask:",
      "  - \"echo ask\"",
      "",
      "deny:",
      "  - \"echo deny\"",
      ""
    ].join("\n")
  );

  fs.writeFileSync(
    verifyPath,
    [
      "version: verify.gates.v1",
      "",
      "modes:",
      "  targeted:",
      "    gates:",
      "      - allow",
      "      - ask",
      "      - deny",
      "  standard:",
      "    gates:",
      "      - allow",
      "  strict:",
      "    gates:",
      "      - allow",
      "",
      "commands:",
      "  allow: \"echo allow\"",
      "  ask: \"echo ask\"",
      "  deny: \"echo deny\"",
      ""
    ].join("\n")
  );

  process.env.TRCODER_PERMISSIONS_PATH = permissionsPath;
  process.env.TRCODER_VERIFY_GATES_PATH = verifyPath;

  const started = await startServer();
  app = started.app;
  baseUrl = started.baseUrl;
}

afterAll(async () => {
  if (app) {
    await stopServer(app);
  }
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  delete process.env.TRCODER_DB_DRIVER;
  delete process.env.TRCODER_DB_PATH;
  delete process.env.TRCODER_PERMISSIONS_PATH;
  delete process.env.TRCODER_VERIFY_GATES_PATH;
});

async function collectEventTypes(runId: string, timeoutMs = 4000): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const types: string[] = [];
  try {
    const res = await fetch(`${baseUrl}/v1/runs/${runId}/stream`, {
      headers: { Authorization: "Bearer dev" },
      signal: controller.signal
    });
    const reader = res.body?.getReader();
    if (!reader) return types;
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
        const parsed = JSON.parse(line.replace(/^data:\s?/, ""));
        types.push(parsed.type);
        idx = buffer.indexOf("\n\n");
      }
    }
    return types;
  } catch {
    return types;
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
}

describe("permissions enforcement", () => {
  it("blocks deny/ask commands and records events", async () => {
    await setup();
    const projectId = await connectProject(baseUrl);

    const permissionMap = new Map<string, string>();
    const { ws, ready } = connectRunner(baseUrl, projectId, (msg) => {
      const cmd = String(msg.cmd ?? "");
      const permissionClass = String(msg.permission_class ?? "");
      permissionMap.set(cmd, permissionClass);

      if (cmd.startsWith("git rev-parse")) {
        return { exit_code: 0, stdout: "DEV" };
      }
      if (cmd.startsWith("git status --porcelain")) {
        return { exit_code: 0, stdout: "" };
      }
      if (cmd.startsWith("git diff --stat")) {
        return { exit_code: 0, stdout: "" };
      }
      if (cmd === "echo allow") {
        return { exit_code: 0, stdout: "ok" };
      }
      if (cmd === "echo ask") {
        return { exit_code: 1, stderr: "User denied command" };
      }
      if (cmd === "echo deny") {
        return { exit_code: 1, stderr: "Denied by permissions" };
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

    await fetch(`${baseUrl}/v1/runs/${runData.run_id}/verify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mode: "targeted" })
    });

    const ledgerRes = await fetch(`${baseUrl}/v1/ledger/export`, {
      headers: { Authorization: "Bearer dev" }
    });
    const ledgerText = await ledgerRes.text();
    const blocked = ledgerText
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.event_type === "RUNNER_CMD_BLOCKED");

    expect(permissionMap.get("echo allow")).toBe("allow");
    expect(permissionMap.get("echo ask")).toBe("ask");
    expect(permissionMap.get("echo deny")).toBe("deny");
    expect(blocked.length).toBeGreaterThanOrEqual(2);

    const sseTypes = await collectEventTypes(runData.run_id);
    expect(sseTypes).toContain("PERMISSION_DENIED");

    ws.close();
  }, 20000);
});
