import { randomUUID } from "crypto";
import { IncomingMessage, Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { classifyCommand, PermissionClass, PermissionsConfig } from "@trcoder/shared";

export interface RunnerResult {
  request_id: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  artifacts?: string[];
  error?: string;
}

interface RunnerConnection {
  socket: WebSocket;
  project_id: string;
  org_id: string;
  user_id: string;
  session_id: string;
  pending: Map<string, (result: RunnerResult) => void>;
}

export class RunnerBridge {
  private wss: WebSocketServer;
  private connections = new Map<string, RunnerConnection>();
  private permissions: PermissionsConfig;
  private onAuthFailed?: (req: IncomingMessage, reason: string) => Promise<void> | void;
  private authorize: (req: IncomingMessage) => Promise<{
    project_id: string;
    org_id: string;
    user_id: string;
  } | null>;

  constructor(
    server: Server,
    permissions: PermissionsConfig,
    authorize: (
      req: IncomingMessage
    ) => Promise<{ project_id: string; org_id: string; user_id: string } | null>,
    onAuthFailed?: (req: IncomingMessage, reason: string) => Promise<void> | void
  ) {
    this.permissions = permissions;
    this.authorize = authorize;
    this.onAuthFailed = onAuthFailed;
    this.wss = new WebSocketServer({ server, path: "/v1/runner/ws" });

    this.wss.on("connection", (socket, req) => {
      void this.handleConnection(socket, req);
    });
  }

  private async handleConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
    const auth = await this.authorize(req);
    if (!auth) {
      await this.onAuthFailed?.(req, "unauthorized");
      socket.close();
      return;
    }
    const pending = new Map<string, (result: RunnerResult) => void>();
    let connection: RunnerConnection | null = null;

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === "HELLO") {
          if (message.project_id !== auth.project_id) {
            void this.onAuthFailed?.(req, "project_mismatch");
            socket.close();
            return;
          }
          const session_id = randomUUID();
          connection = {
            socket,
            project_id: auth.project_id,
            org_id: auth.org_id,
            user_id: auth.user_id,
            session_id,
            pending
          };
          this.connections.set(auth.project_id, connection);
          socket.send(
            JSON.stringify({
              type: "HELLO_ACK",
              ts: new Date().toISOString(),
              runner_session_id: session_id
            })
          );
          return;
        }

        if (message.type === "RUNNER_RESULT" && connection) {
          if (message.runner_session_id !== connection.session_id) {
            return;
          }
          const handler = pending.get(message.request_id);
          if (handler) {
            pending.delete(message.request_id);
            handler(message as RunnerResult);
          }
          return;
        }
      } catch {
        // ignore invalid messages
      }
    });

    socket.on("close", () => {
      if (connection) {
        this.connections.delete(connection.project_id);
      }
    });
  }

  hasRunner(projectId: string): boolean {
    return this.connections.has(projectId);
  }

  private getConnection(projectId: string): RunnerConnection {
    const conn = this.connections.get(projectId);
    if (!conn) {
      throw new Error(`Runner not connected for project ${projectId}`);
    }
    return conn;
  }

  async sendExec(input: {
    project_id: string;
    cmd: string;
    cwd?: string;
    timeout_ms?: number;
  }): Promise<RunnerResult> {
    const permission_class: PermissionClass = classifyCommand(input.cmd, this.permissions);
    return this.sendRequest(input.project_id, {
      type: "RUNNER_EXEC",
      runner_session_id: this.getConnection(input.project_id).session_id,
      cmd: input.cmd,
      cwd: input.cwd,
      timeout_ms: input.timeout_ms ?? 120000,
      permission_class
    });
  }

  async sendRead(input: {
    project_id: string;
    path: string;
    range?: { start_line: number; end_line: number };
  }): Promise<RunnerResult> {
    return this.sendRequest(input.project_id, {
      type: "RUNNER_READ",
      runner_session_id: this.getConnection(input.project_id).session_id,
      path: input.path,
      range: input.range
    });
  }

  async sendGrep(input: {
    project_id: string;
    query: string;
    scope?: string;
  }): Promise<RunnerResult> {
    return this.sendRequest(input.project_id, {
      type: "RUNNER_GREP",
      runner_session_id: this.getConnection(input.project_id).session_id,
      query: input.query,
      scope: input.scope
    });
  }

  async sendList(input: {
    project_id: string;
    glob?: string;
    root?: string;
    limit?: number;
  }): Promise<RunnerResult> {
    return this.sendRequest(input.project_id, {
      type: "RUNNER_LIST",
      runner_session_id: this.getConnection(input.project_id).session_id,
      glob: input.glob,
      root: input.root,
      limit: input.limit
    });
  }

  async sendWrite(input: {
    project_id: string;
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
  }): Promise<RunnerResult> {
    return this.sendRequest(input.project_id, {
      type: "RUNNER_WRITE",
      runner_session_id: this.getConnection(input.project_id).session_id,
      path: input.path,
      content: input.content,
      encoding: input.encoding ?? "utf8"
    });
  }

  private sendRequest(project_id: string, payload: Record<string, unknown>): Promise<RunnerResult> {
    const conn = this.getConnection(project_id);
    const request_id = randomUUID();

    const resultPromise = new Promise<RunnerResult>((resolve) => {
      conn.pending.set(request_id, resolve);
    });

    conn.socket.send(JSON.stringify({ request_id, ...payload }));
    return resultPromise;
  }
}
