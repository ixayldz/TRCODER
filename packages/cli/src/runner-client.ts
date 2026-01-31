import { WebSocket } from "ws";
import { classifyCommand, PermissionClass, PermissionsConfig } from "@trcoder/shared";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

interface RunnerClientOptions {
  serverUrl: string;
  apiKey: string;
  projectId: string;
  orgId?: string;
  userId?: string;
  permissions: PermissionsConfig;
  confirm?: (question: string) => Promise<boolean>;
  log?: (message: string) => void;
}

const MAX_READ_LINES = 2000;

function rankPermission(permission: PermissionClass): number {
  if (permission === "deny") return 2;
  if (permission === "ask") return 1;
  return 0;
}

function mostRestrictive(a: PermissionClass, b: PermissionClass): PermissionClass {
  return rankPermission(a) >= rankPermission(b) ? a : b;
}

function runShellCommand(cmd: string, cwd?: string, timeoutMs = 120000): Promise<{
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(cmd, {
      shell: true,
      cwd: cwd || process.cwd(),
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    const limit = 20000;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > limit) stdout = stdout.slice(-limit);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > limit) stderr = stderr.slice(-limit);
    });

    const timeout = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exit_code: code ?? 1, stdout, stderr, duration_ms: Date.now() - start });
    });
  });
}

function readFileRange(filePath: string, range?: { start_line: number; end_line: number }): string {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  if (!range) {
    return lines.slice(0, MAX_READ_LINES).join("\n");
  }
  const start = Math.max(range.start_line - 1, 0);
  const end = Math.min(range.end_line, lines.length);
  return lines.slice(start, end).join("\n");
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = `^${escaped.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*")}$`;
  return new RegExp(regex, "i");
}

function listFiles(
  root: string,
  glob?: string,
  limit = 200
): Array<{ path: string; size: number; sha256: string }> {
  const results: Array<{ path: string; size: number; sha256: string }> = [];
  const regex = glob ? globToRegex(glob) : null;

  const walk = (dir: string) => {
    if (results.length >= limit) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        if (!regex || regex.test(rel)) {
          const stat = fs.statSync(full);
          const content = fs.readFileSync(full);
          const sha256 = crypto.createHash("sha256").update(content).digest("hex");
          results.push({ path: rel, size: stat.size, sha256 });
          if (results.length >= limit) return;
        }
      }
    }
  };

  walk(root);
  return results;
}

const MAX_GREP_MATCHES = 200;

async function grepInPath(query: string, scope: string): Promise<string> {
  const results: string[] = [];
  const stat = fs.statSync(scope);
  if (stat.isFile()) {
    const content = fs.readFileSync(scope, "utf8");
    if (content.includes(query)) {
      results.push(`${scope}:1:${query}`);
    }
    return results.join("\n");
  }

  const entries = fs.readdirSync(scope);
  for (const entry of entries) {
    const full = path.join(scope, entry);
    const sub = fs.statSync(full);
    if (sub.isDirectory()) {
      results.push(await grepInPath(query, full));
    } else if (sub.isFile()) {
      const content = fs.readFileSync(full, "utf8");
      if (content.includes(query)) {
        results.push(`${full}:1:${query}`);
      }
    }
    if (results.filter(Boolean).length >= MAX_GREP_MATCHES) {
      break;
    }
  }
  return results.filter(Boolean).join("\n");
}

export class RunnerClient {
  private socket?: WebSocket;
  private options: RunnerClientOptions;
  private sessionId?: string;

  constructor(options: RunnerClientOptions) {
    this.options = options;
  }

  connect(): void {
    const wsUrl = this.options.serverUrl.replace("http", "ws") + "/v1/runner/ws";
    this.socket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "X-TRCODER-Project": this.options.projectId
      }
    });

    this.socket.on("open", () => {
      this.socket?.send(
        JSON.stringify({
          type: "HELLO",
          project_id: this.options.projectId,
          org_id: this.options.orgId,
          user_id: this.options.userId
        })
      );
    });

    this.socket.on("message", async (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "HELLO_ACK") {
        this.sessionId = message.runner_session_id;
        return;
      }
      if (message.type === "RUNNER_EXEC") {
        const cmd = String(message.cmd ?? "");
        const serverClass = (message.permission_class ?? "ask") as PermissionClass;
        const localClass = classifyCommand(cmd, this.options.permissions);
        const effective = mostRestrictive(serverClass, localClass);

        if (effective === "deny") {
          this.socket?.send(
            JSON.stringify({
              type: "RUNNER_RESULT",
              request_id: message.request_id,
              runner_session_id: this.sessionId,
              exit_code: 1,
              stdout: "",
              stderr: "Denied by permissions",
              duration_ms: 0
            })
          );
          return;
        }

        if (effective === "ask") {
          const allowed = this.options.confirm
            ? await this.options.confirm(`Allow command? ${cmd}`)
            : false;
          if (!allowed) {
            this.socket?.send(
              JSON.stringify({
                type: "RUNNER_RESULT",
                request_id: message.request_id,
                runner_session_id: this.sessionId,
                exit_code: 1,
                stdout: "",
                stderr: "User denied command",
                duration_ms: 0
              })
            );
            return;
          }
        }

        const result = await runShellCommand(cmd, message.cwd, message.timeout_ms);
        this.socket?.send(
          JSON.stringify({
            type: "RUNNER_RESULT",
            request_id: message.request_id,
            runner_session_id: this.sessionId,
            ...result
          })
        );
        return;
      }

      if (message.type === "RUNNER_READ") {
        try {
          const content = readFileRange(message.path, message.range);
          this.socket?.send(
            JSON.stringify({
              type: "RUNNER_RESULT",
              request_id: message.request_id,
              runner_session_id: this.sessionId,
              exit_code: 0,
              stdout: content,
              stderr: "",
              duration_ms: 0
            })
          );
        } catch (err) {
          this.socket?.send(
            JSON.stringify({
              type: "RUNNER_RESULT",
              request_id: message.request_id,
              runner_session_id: this.sessionId,
              exit_code: 1,
              stdout: "",
              stderr: (err as Error).message,
              duration_ms: 0
            })
          );
        }
        return;
      }

      if (message.type === "RUNNER_GREP") {
        try {
          const output = await grepInPath(message.query, message.scope ?? process.cwd());
          this.socket?.send(
            JSON.stringify({
              type: "RUNNER_RESULT",
              request_id: message.request_id,
              runner_session_id: this.sessionId,
              exit_code: 0,
              stdout: output,
              stderr: "",
              duration_ms: 0
            })
          );
        } catch (err) {
          this.socket?.send(
            JSON.stringify({
              type: "RUNNER_RESULT",
              request_id: message.request_id,
              runner_session_id: this.sessionId,
              exit_code: 1,
              stdout: "",
              stderr: (err as Error).message,
              duration_ms: 0
            })
          );
        }
        return;
      }

      if (message.type === "RUNNER_LIST") {
        try {
          const items = listFiles(
            message.root ?? process.cwd(),
            message.glob,
            Number(message.limit ?? 200)
          );
          this.socket?.send(
            JSON.stringify({
              type: "RUNNER_RESULT",
              request_id: message.request_id,
              runner_session_id: this.sessionId,
              exit_code: 0,
              stdout: JSON.stringify(items),
              stderr: "",
              duration_ms: 0
            })
          );
        } catch (err) {
          this.socket?.send(
            JSON.stringify({
              type: "RUNNER_RESULT",
              request_id: message.request_id,
              runner_session_id: this.sessionId,
              exit_code: 1,
              stdout: "",
              stderr: (err as Error).message,
              duration_ms: 0
            })
          );
        }
        return;
      }
    });

    this.socket.on("error", (err) => {
      this.options.log?.(`runner ws error: ${err}`);
    });
  }
}
