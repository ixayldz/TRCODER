import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import {
  ContextPackManifest,
  Lane,
  RiskLevel,
  TasksFileV1,
  createLedgerEvent,
  decideRouter,
  estimateTokens,
  calculateCost,
  loadLanePolicy,
  loadModelStack,
  loadPermissions,
  loadPricing,
  loadRiskPolicy,
  loadVerifyGates,
  validateAllConfig
} from "@trcoder/shared";
import { createDb } from "./db";
import { writeArtifact, writePlanArtifact } from "./artifacts";
import { buildContextPack } from "./context-pack";
import { getContextPackRecord, saveContextPack, updateContextPack } from "./context-pack-store";
import { MockModelProvider } from "./mock-provider";
import { RunEventHub } from "./run-events";
import { appendLedgerEvent, listLedgerEvents } from "./ledger-store";
import { RunnerBridge } from "./runner-bridge";
import { computeInvoicePreview, computeUsageForMonth, computeUsageForRange } from "./billing";
import { redactText } from "./redaction";
import { getArtifactsDir } from "./storage";
import { buildOpsPackPatch } from "./ops-pack";

interface AuthContext {
  api_key: string;
  org_id: string;
  user_id: string;
  plan_id: string;
}

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, "config", "model-stack.v2.json");
    if (fs.existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

function loadExampleTasks(repoRoot: string): TasksFileV1 {
  const candidates = [
    path.join(repoRoot, "task", "example.tasks.v1.json"),
    path.join(repoRoot, "tasks", "example.tasks.v1.json")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8")) as TasksFileV1;
    }
  }
  throw new Error("example.tasks.v1.json not found");
}

function resolveVerifyMode(laneMode: string, riskMode: string): "targeted" | "standard" | "strict" {
  const order = ["targeted", "standard", "strict"] as const;
  const laneIndex = order.indexOf(laneMode as typeof order[number]);
  const riskIndex = order.indexOf(riskMode as typeof order[number]);
  return order[Math.max(laneIndex, riskIndex)];
}

const MAX_CTX_CHARS = 8000;
const MAX_LOG_LINES = 200;

function limitText(text: string, maxChars = MAX_CTX_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...<truncated>";
}

function tailLines(text: string, maxLines: number): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return lines;
  return lines.slice(lines.length - maxLines);
}

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function trimSnippet(text: string, maxChars = 200): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "...";
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
  return regex.test(value);
}

export async function createServer(options?: {
  onRoute?: (route: { method: string | string[]; url: string }) => void;
}): Promise<{
  app: FastifyInstance;
  db: Awaited<ReturnType<typeof createDb>>;
}> {
  const repoRoot = findRepoRoot(process.cwd());
  const configRoot = process.env.TRCODER_CONFIG_ROOT ?? repoRoot;
  const modelStack = loadModelStack(
    process.env.TRCODER_MODEL_STACK_PATH ?? path.join(configRoot, "config", "model-stack.v2.json")
  );
  const lanePolicy = loadLanePolicy(
    process.env.TRCODER_LANE_POLICY_PATH ?? path.join(configRoot, "config", "lane-policy.v1.yaml")
  );
  const riskPolicy = loadRiskPolicy(
    process.env.TRCODER_RISK_POLICY_PATH ?? path.join(configRoot, "config", "risk-policy.v1.yaml")
  );
  const pricing = loadPricing(
    process.env.TRCODER_PRICING_PATH ?? path.join(configRoot, "config", "pricing.v1.yaml")
  );
  const permissions = loadPermissions(
    process.env.TRCODER_PERMISSIONS_PATH ??
      path.join(configRoot, "config", "permissions.defaults.yaml")
  );
  const verifyGates = loadVerifyGates(
    process.env.TRCODER_VERIFY_GATES_PATH ?? path.join(configRoot, "config", "verify.gates.yaml")
  );

  const configValidation = validateAllConfig({ modelStack, lanePolicy, riskPolicy });
  if (!configValidation.ok) {
    const details = configValidation.errors.map((err) => `- ${err}`).join("\n");
    throw new Error(`Config validation failed:\n${details}`);
  }
  if (configValidation.warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`Config warnings:\n${configValidation.warnings.map((w) => `- ${w}`).join("\n")}`);
  }

  const dbPath = process.env.TRCODER_DB_PATH;
  const db = await createDb(dbPath);
  const app = Fastify({ logger: false });
  if (options?.onRoute) {
    app.addHook("onRoute", options.onRoute);
  }
  const events = new RunEventHub();
  const modelProvider = new MockModelProvider();
  const runnerBridge = new RunnerBridge(
    app.server,
    permissions,
    (req) => {
      const auth = req.headers["authorization"];
      const projectHeader = req.headers["x-trcoder-project"];
      if (!auth || !auth.toString().startsWith("Bearer ")) {
        return null;
      }
      const api_key = auth.toString().slice("Bearer ".length);
      const record = db.query<{ org_id: string; user_id: string }>(
        "SELECT org_id, user_id FROM api_keys WHERE key = ?",
        [api_key]
      )[0];
      if (!record || !projectHeader) {
        return null;
      }
      const project_id = projectHeader.toString();
      const project = db.query("SELECT id FROM projects WHERE id = ?", [project_id])[0];
      if (!project) {
        return null;
      }
      return { project_id, org_id: record.org_id, user_id: record.user_id };
    },
    (req, reason) => {
      const projectHeader = req.headers["x-trcoder-project"];
      const project_id = projectHeader ? projectHeader.toString() : "unknown";
      appendLedgerEvent(
        db,
        createLedgerEvent({
          org_id: "unknown",
          user_id: "unknown",
          project_id,
          event_type: "RUNNER_AUTH_FAILED",
          payload: { reason }
        })
      );
    }
  );

  async function enrichContextPack(
    pack: ContextPackManifest,
    projectId: string
  ): Promise<ContextPackManifest> {
    if (!runnerBridge.hasRunner(projectId)) {
      return pack;
    }

    const updatedEntries = [...pack.file_entries];
    for (let i = 0; i < updatedEntries.length; i += 1) {
      const entry = updatedEntries[i];
      if (!entry.path || entry.hash) continue;
      const resolved = path.isAbsolute(entry.path) ? entry.path : path.join(repoRoot, entry.path);
      try {
        const result = await runnerBridge.sendRead({
          project_id: projectId,
          path: resolved,
          range: { start_line: 1, end_line: 1000000 }
        });
        if (result.exit_code === 0) {
          const content = result.stdout ?? "";
          const hash = createHash("sha256").update(content).digest("hex");
          const lineCount = content.split(/\r?\n/).length;
          updatedEntries[i] = {
            ...entry,
            hash,
            range: entry.range ?? { start_line: 1, end_line: lineCount }
          };
        }
      } catch {
        // ignore per-file failures
      }
    }

    return { ...pack, file_entries: updatedEntries };
  }

  function getPlanTasksCount(tasks: TasksFileV1): number {
    return tasks.phases.reduce((total, phase) => total + phase.tasks.length, 0);
  }

  function computeSessionStats(runId: string) {
    const run = db.query<Record<string, unknown>>("SELECT * FROM runs WHERE id = ?", [runId])[0] as
      | { created_at: string; cost_to_date: number; budget_cap_usd: number; plan_id: string }
      | undefined;
    if (!run) return null;

    const planRow = db.query<{ tasks_json?: string }>(
      "SELECT tasks_json FROM plans WHERE id = ?",
      [run.plan_id]
    )[0];
    const tasksFile = planRow?.tasks_json ? (JSON.parse(planRow.tasks_json) as TasksFileV1) : null;
    const tasks_total = tasksFile ? getPlanTasksCount(tasksFile) : 0;
    const tasks_completed = db.query<{ cnt: number }>(
      "SELECT COUNT(1) as cnt FROM tasks WHERE run_id = ? AND state = ?",
      [runId, "DONE"]
    )[0] ?? { cnt: 0 };

    const events = listLedgerEvents(db, "1970-01-01T00:00:00.000Z", new Date().toISOString()).filter(
      (event) => event.run_id === runId && event.event_type === "LLM_CALL_FINISHED"
    );
    const modelMap = new Map<string, { calls: number; provider: number; charge: number }>();
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      const model = String(payload.model ?? "unknown");
      const provider_cost = Number(payload.provider_cost_usd ?? 0);
      const charge = Number(payload.our_charge_usd ?? 0);
      const entry = modelMap.get(model) ?? { calls: 0, provider: 0, charge: 0 };
      entry.calls += 1;
      entry.provider += provider_cost;
      entry.charge += charge;
      modelMap.set(model, entry);
    }

    const elapsed = Math.max(0, Date.now() - new Date(run.created_at).getTime());
    return {
      time_elapsed_sec: Math.round(elapsed / 1000),
      tasks_completed: tasks_completed.cnt,
      tasks_total,
      cost_to_date_usd: run.cost_to_date,
      budget_remaining_usd: run.budget_cap_usd - run.cost_to_date,
      model_usage: Array.from(modelMap.entries()).map(([model, totals]) => ({
        model,
        calls: totals.calls,
        provider_cost_usd: Number(totals.provider.toFixed(4)),
        charged_usd: Number(totals.charge.toFixed(4))
      }))
    };
  }

  type RepoState = {
    current_commit: string | null;
    dirty: boolean;
    available: boolean;
    error?: string;
  };

  async function getRepoState(projectId: string): Promise<RepoState> {
    if (!runnerBridge.hasRunner(projectId)) {
      return { current_commit: null, dirty: false, available: false, error: "runner_not_connected" };
    }
    let current_commit: string | null = null;
    let dirty = false;
    try {
      const commitResult = await runnerBridge.sendExec({
        project_id: projectId,
        cmd: "git rev-parse HEAD",
        cwd: repoRoot
      });
      if (commitResult.exit_code === 0) {
        current_commit = (commitResult.stdout ?? "").trim() || null;
      }
      const statusResult = await runnerBridge.sendExec({
        project_id: projectId,
        cmd: "git status --porcelain",
        cwd: repoRoot
      });
      if (statusResult.exit_code === 0) {
        dirty = Boolean((statusResult.stdout ?? "").trim());
      }
    } catch (err) {
      return {
        current_commit,
        dirty,
        available: false,
        error: (err as Error).message
      };
    }
    return { current_commit, dirty, available: true };
  }

  function computeStale(approvedCommit: string | null | undefined, repoState: RepoState) {
    if (!approvedCommit) {
      return { stale: false, reason: null as string | null };
    }
    if (!repoState.available || !repoState.current_commit) {
      return { stale: true, reason: repoState.error ?? "repo_state_unavailable" };
    }
    if (repoState.dirty) {
      return { stale: true, reason: "working_tree_dirty" };
    }
    if (repoState.current_commit !== approvedCommit) {
      return { stale: true, reason: "commit_mismatch" };
    }
    return { stale: false, reason: null as string | null };
  }

  function emitTaskStage(input: {
    run_id: string;
    task_id: string;
    stage: string;
    message: string;
    org_id: string;
    user_id: string;
    project_id: string;
    plan_id: string;
  }) {
    events.emit(input.run_id, {
      type: "TASK_STAGE",
      ts: new Date().toISOString(),
      data: {
        run_id: input.run_id,
        task_id: input.task_id,
        stage: input.stage,
        message: input.message
      }
    });

    appendLedgerEvent(
      db,
      createLedgerEvent({
        org_id: input.org_id,
        user_id: input.user_id,
        project_id: input.project_id,
        run_id: input.run_id,
        plan_id: input.plan_id,
        task_id: input.task_id,
        event_type: "TASK_STAGE",
        payload: { stage: input.stage, message: input.message }
      })
    );
  }

  function requireAuth(req: FastifyRequest, reply: FastifyReply): AuthContext | null {
    const auth = req.headers["authorization"];
    if (!auth || !auth.toString().startsWith("Bearer ")) {
      reply.code(401).send({ error: "missing api key" });
      return null;
    }
    const api_key = auth.toString().slice("Bearer ".length);
    const record = db.query<Record<string, string>>(
      "SELECT * FROM api_keys WHERE key = ?",
      [api_key]
    )[0] as
      | { key: string; org_id: string; user_id: string; plan_id: string }
      | undefined;
    if (!record) {
      reply.code(401).send({ error: "invalid api key" });
      return null;
    }
    return { api_key, org_id: record.org_id, user_id: record.user_id, plan_id: record.plan_id };
  }

  app.post("/v1/projects/connect", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const body = req.body as { repo_name: string; repo_root_hash: string };
    const project_id = randomUUID();
    db.exec(
      "INSERT INTO projects (id, repo_name, repo_root_hash, created_at) VALUES (?, ?, ?, ?)",
      [project_id, body.repo_name, body.repo_root_hash, new Date().toISOString()]
    );

    reply.send({ project_id });
  });

  app.get("/v1/whoami", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const usage = computeUsageForMonth({ db, pricing, plan_id: auth.plan_id });
    reply.send({
      org_id: auth.org_id,
      user_id: auth.user_id,
      plan_id: auth.plan_id,
      credits_included: pricing.plans[auth.plan_id]?.included_credits_trc ?? 0,
      credits_used: usage.credits_used,
      payg_overage: usage.payg_overage
    });
  });

  app.post("/v1/projects/:id/plan", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const project_id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { input?: { text?: string; files?: Array<{ path: string; content: string }> }; pins?: string[] };

    const plan_id = `plan_${Date.now()}`;
    const tasks = loadExampleTasks(repoRoot);
    tasks.plan_id = plan_id;

    const planMd = `# Plan ${plan_id}\n\nGenerated by TRCODER mock planner.`;
    const risksMd = `# Risks\n\n- Mock risk list (V1).`;

    const planArtifact = writePlanArtifact(plan_id, "plan.md", planMd);
    const tasksArtifact = writePlanArtifact(plan_id, "tasks.v1.json", JSON.stringify(tasks, null, 2));
    const risksArtifact = writePlanArtifact(plan_id, "risks.md", risksMd);

    const artifacts = [
      { path: `artifacts/${project_id}/${plan_id}/plan.md`, kind: "plan.md" },
      { path: `artifacts/${project_id}/${plan_id}/tasks.v1.json`, kind: "tasks.v1.json" },
      { path: `artifacts/${project_id}/${plan_id}/risks.md`, kind: "risks.md" }
    ];

    db.exec(
      "INSERT INTO plans (id, project_id, created_at, approved_at, repo_commit, artifacts_json, tasks_json, input_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        plan_id,
        project_id,
        new Date().toISOString(),
        null,
        null,
        JSON.stringify(artifacts),
        JSON.stringify(tasks),
        JSON.stringify({ input: body.input ?? {}, pins: body.pins ?? [] })
      ]
    );

    const planEvent = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id,
      event_type: "PLAN_CREATED",
      payload: { artifacts }
    });
    appendLedgerEvent(db, planEvent);

    reply.send({ plan_id, artifacts });
  });

  app.post("/v1/projects/:id/plan/approve", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const body = req.body as { plan_id: string; repo_commit: string };

    db.exec("UPDATE plans SET approved_at = ?, repo_commit = ? WHERE id = ? AND project_id = ?", [
      new Date().toISOString(),
      body.repo_commit,
      body.plan_id,
      project_id
    ]);

    const event = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id: body.plan_id,
      event_type: "PLAN_APPROVED",
      payload: { repo_commit: body.repo_commit }
    });
    appendLedgerEvent(db, event);

    reply.send({ ok: true });
  });

  app.get("/v1/projects/:id/plan/status", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;

    const latest = db.query<{ id?: string; repo_commit?: string }>(
      "SELECT id, repo_commit FROM plans WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
      [project_id]
    )[0];
    const approved = db.query<{ id?: string; repo_commit?: string }>(
      "SELECT id, repo_commit FROM plans WHERE project_id = ? AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1",
      [project_id]
    )[0];

    const repoState = await getRepoState(project_id);
    const staleInfo = computeStale(approved?.repo_commit, repoState);

    appendLedgerEvent(
      db,
      createLedgerEvent({
        org_id: auth.org_id,
        user_id: auth.user_id,
        project_id,
        plan_id: approved?.id ?? latest?.id ?? null,
        event_type: "PLAN_STATUS",
        payload: {
          latest_plan_id: latest?.id ?? null,
          approved_plan_id: approved?.id ?? null,
          approved_repo_commit: approved?.repo_commit ?? null,
          current_repo_commit: repoState.current_commit,
          dirty: repoState.available ? repoState.dirty : null,
          stale: staleInfo.stale,
          stale_reason: staleInfo.reason
        }
      })
    );

    reply.send({
      latest_plan_id: latest?.id ?? null,
      approved_plan_id: approved?.id ?? null,
      latest_repo_commit: latest?.repo_commit ?? null,
      approved_repo_commit: approved?.repo_commit ?? null,
      current_repo_commit: repoState.current_commit,
      dirty: repoState.available ? repoState.dirty : null,
      stale: staleInfo.stale,
      stale_reason: staleInfo.reason
    });
  });

  app.post("/v1/projects/:id/runs/start", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as {
      plan_id?: string;
      lane?: Lane;
      risk?: RiskLevel;
      budget_cap_usd?: number;
      task_id?: string;
      confirm_high_risk?: boolean;
      confirm_stale?: boolean;
      model?: string;
      context_budget?: {
        max_files: number;
        max_lines: number;
        graph_depth: number;
        top_k: number;
        hydrate: boolean;
      };
    };

    if (body.model) {
      reply.code(400).send({ error: "model_override_not_allowed" });
      return;
    }

    const planRow = db.query<{ id: string; tasks_json: string; input_json: string; repo_commit?: string }>(
      "SELECT id, tasks_json, input_json, repo_commit FROM plans WHERE project_id = ? AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1",
      [project_id]
    )[0];

    const plan_id = body.plan_id ?? planRow?.id;
    if (!plan_id || !planRow) {
      reply.code(400).send({ error: "no approved plan" });
      return;
    }

    const repoState = await getRepoState(project_id);
    const staleInfo = computeStale(planRow.repo_commit, repoState);
    if (staleInfo.stale && !body.confirm_stale) {
      reply.code(409).send({
        error: "plan_stale",
        stale: true,
        stale_reason: staleInfo.reason,
        current_repo_commit: repoState.current_commit,
        approved_repo_commit: planRow.repo_commit ?? null,
        dirty: repoState.available ? repoState.dirty : null
      });
      return;
    }

    const run_id = randomUUID();
    const lane = body.lane ?? "balanced";
    const risk = body.risk ?? "standard";
    const budget_cap_usd = body.budget_cap_usd ?? 10;

    db.exec(
      "INSERT INTO runs (id, project_id, plan_id, state, lane, risk, budget_cap_usd, cost_to_date, current_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        run_id,
        project_id,
        plan_id,
        "RUNNING",
        lane,
        risk,
        budget_cap_usd,
        0,
        null,
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );

    const tasks = JSON.parse(planRow.tasks_json) as TasksFileV1;
    const taskId = body.task_id;
    const allTasks = tasks.phases.flatMap((phase) => phase.tasks);
    const firstTask = taskId ? allTasks.find((task) => task.id === taskId) : allTasks[0];
    if (!firstTask) {
      reply.code(400).send({ error: "plan has no tasks" });
      return;
    }

    const needsConfirm =
      riskPolicy.risk_levels[risk]?.requires_confirmation === true ||
      firstTask.risk === "high" ||
      riskPolicy.high_risk_task_types.includes(firstTask.type) ||
      (firstTask.scope?.paths ?? []).some((p) =>
        riskPolicy.high_risk_path_patterns.some((pattern) => globMatch(pattern, p))
      );
    if (needsConfirm && !body.confirm_high_risk) {
      reply.code(409).send({ error: "high_risk_confirmation_required" });
      return;
    }

    db.exec(
      "INSERT INTO tasks (id, run_id, plan_task_id, title, type, risk, state, router_decision_json, patch_path, patch_text, cost_usd, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        randomUUID(),
        run_id,
        firstTask.id,
        firstTask.title,
        firstTask.type,
        firstTask.risk,
        "RUNNING",
        null,
        null,
        null,
        0,
        0,
        0
      ]
    );

    const verifyMode = resolveVerifyMode(
      lanePolicy.lanes[lane].verify_mode,
      riskPolicy.risk_levels[risk].verify_strictness
    );
    const planType = pricing.plans[auth.plan_id] ? "subscription" : "payg";

    const contextBudget = body.context_budget ?? lanePolicy.lanes[lane].context_budget;

    const tasks_total = getPlanTasksCount(tasks);

    events.emit(run_id, {
      type: "RUN_BANNER",
      ts: new Date().toISOString(),
      data: {
        plan_type: planType,
        plan_id: auth.plan_id,
        lane,
        risk,
        gates_mode: verifyMode,
        repo: project_id,
        commit: tasks.repo_commit ?? "DEV",
        approved_plan_id: plan_id,
        budget_cap_usd,
        cost_to_date_usd: 0,
        budget_remaining_usd: budget_cap_usd,
        verify_mode: verifyMode,
        fix_loop_max_iters: lanePolicy.lanes[lane].fix_loop_max_iters
      }
    });

    const runEvent = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      event_type: "RUN_STARTED",
      payload: { lane, risk, budget_cap_usd }
    });
    appendLedgerEvent(db, runEvent);

    emitTaskStage({
      run_id,
      task_id: firstTask.id,
      stage: "PREPARE_CONTEXT",
      message: "Building context pack",
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id
    });

    const inputMeta = JSON.parse(planRow.input_json ?? "{}");
    const pins = (inputMeta.pins ?? []) as string[];

    const signals: ContextPackManifest["signals"] = {};
    if (runnerBridge.hasRunner(project_id)) {
      const diffResult = await runnerBridge.sendExec({
        project_id,
        cmd: "git diff --stat",
        cwd: repoRoot
      });
      if (diffResult.exit_code === 0) {
        signals.diff_summary = limitText(diffResult.stdout ?? "", 2000);
      }
      const statusResult = await runnerBridge.sendExec({
        project_id,
        cmd: "git status --short",
        cwd: repoRoot
      });
      if (statusResult.exit_code === 0) {
        const lines = (statusResult.stdout ?? "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          signals.logs = lines.slice(0, 50);
        }
      }
    }

    const lastVerify = db.query<{ payload_json?: string }>(
      "SELECT payload_json FROM ledger_events WHERE project_id = ? AND event_type = ? ORDER BY ts DESC LIMIT 1",
      [project_id, "VERIFY_FINISHED"]
    )[0];
    if (lastVerify?.payload_json) {
      const payload = JSON.parse(lastVerify.payload_json || "{}") as { status?: string; report_path?: string };
      if (payload.status === "fail" && payload.report_path) {
        const parts = payload.report_path.split("/");
        const failureRunId = parts.length >= 3 ? parts[2] : run_id;
        const reportPath = path.join(getArtifactsDir(), `run-${failureRunId}`, "verify-report.md");
        if (fs.existsSync(reportPath)) {
          const content = fs.readFileSync(reportPath, "utf8");
          const failures = content
            .split(/\r?\n/)
            .filter((line) => line.includes("FAIL"))
            .slice(0, 10);
          if (failures.length > 0) {
            signals.failing_tests = failures;
          }
        }
      }
    }

    let contextPack = buildContextPack({
      runId: run_id,
      taskId: firstTask.id,
      budgets: contextBudget,
      pins,
      signals
    });
    contextPack = await enrichContextPack(contextPack, project_id);
    saveContextPack(db, { project_id, manifest: contextPack });

    const ctxEvent = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      task_id: firstTask.id,
      event_type: "CONTEXT_PACK_BUILT",
      payload: contextPack as unknown as Record<string, unknown>
    });
    appendLedgerEvent(db, ctxEvent);

    const routerDecision = decideRouter({
      taskType: firstTask.type,
      lane,
      risk,
      budgetRemainingUsd: budget_cap_usd,
      contextBudget,
      modelStack,
      lanePolicy,
      riskPolicy
    });

    db.exec("UPDATE tasks SET router_decision_json = ? WHERE run_id = ? AND plan_task_id = ?", [
      JSON.stringify(routerDecision),
      run_id,
      firstTask.id
    ]);

    const routerEvent = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      task_id: firstTask.id,
      event_type: "ROUTER_DECISION",
      payload: routerDecision as unknown as Record<string, unknown>
    });
    appendLedgerEvent(db, routerEvent);

    const taskStartedEvent = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      task_id: firstTask.id,
      event_type: "TASK_STARTED",
      payload: { task_id: firstTask.id, title: firstTask.title, type: firstTask.type, risk: firstTask.risk }
    });
    appendLedgerEvent(db, taskStartedEvent);

    events.emit(run_id, {
      type: "TASK_STARTED",
      ts: new Date().toISOString(),
      data: {
        task_id: firstTask.id,
        title: firstTask.title,
        task_type: firstTask.type,
        selected_model: routerDecision.selected_model,
        context_pack: { id: contextPack.pack_id, budgets: contextPack.budgets, mode: contextPack.mode },
        expected_cost_range: {
          p90: Number(routerDecision.expected_cost_usd.toFixed(4)),
          p50: Number((routerDecision.expected_cost_usd * 0.7).toFixed(4))
        },
        budget_remaining: budget_cap_usd,
        tasks_total,
        tasks_completed: 0
      }
    });

    if (routerDecision.budget_violation) {
      events.emit(run_id, {
        type: "ANOMALY",
        ts: new Date().toISOString(),
        data: {
          expected_p90: routerDecision.expected_cost_usd,
          actual: 0,
          reason: "budget cap would be exceeded",
          action: "paused",
          suggestions: ["/budget cap", "/lane set cost-saver", "/context trim"]
        }
      });

      db.exec("UPDATE runs SET state = ? WHERE id = ?", ["PAUSED", run_id]);
      const anomaly = createLedgerEvent({
        org_id: auth.org_id,
        user_id: auth.user_id,
        project_id,
        run_id,
        plan_id,
        task_id: firstTask.id,
        event_type: "ANOMALY_DETECTED",
        payload: { reason: "budget" }
      });
      appendLedgerEvent(db, anomaly);

      const paused = createLedgerEvent({
        org_id: auth.org_id,
        user_id: auth.user_id,
        project_id,
        run_id,
        plan_id,
        event_type: "RUN_PAUSED",
        payload: { reason: "budget" }
      });
      appendLedgerEvent(db, paused);

      reply.send({ run_id });
      return;
    }

    emitTaskStage({
      run_id,
      task_id: firstTask.id,
      stage: "DESIGN",
      message: "Preparing patch plan",
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id
    });

    const tokensEstimate = estimateTokens(firstTask.type, lane, risk);
    const llmStart = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      task_id: firstTask.id,
      event_type: "LLM_CALL_STARTED",
      payload: { model: routerDecision.selected_model }
    });
    appendLedgerEvent(db, llmStart);

    const mockPatch = await modelProvider.generatePatch({ task_id: firstTask.id });
    const usageSoFar = computeUsageForMonth({ db, pricing, plan_id: auth.plan_id });
    const creditsRemaining = Math.max(
      0,
      (pricing.plans[auth.plan_id]?.included_credits_trc ?? 0) - usageSoFar.credits_used
    );
    const cost = calculateCost({
      model: routerDecision.selected_model,
      tokens_in: Math.round(tokensEstimate * 0.7),
      tokens_out: Math.round(tokensEstimate * 0.3),
      pricing,
      modelStack,
      plan_id: auth.plan_id,
      credits_remaining_trc: creditsRemaining
    });

    const llmFinish = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      task_id: firstTask.id,
      event_type: "LLM_CALL_FINISHED",
      payload: {
        model: routerDecision.selected_model,
        task_type: firstTask.type,
        tokens_in: Math.round(tokensEstimate * 0.7),
        tokens_out: Math.round(tokensEstimate * 0.3),
        provider_cost_usd: cost.provider_cost_usd,
        credits_applied_usd: cost.credits_applied_usd,
        billable_provider_cost_usd: cost.billable_provider_cost_usd,
        markup_rate: cost.markup_rate,
        our_charge_usd: cost.our_charge_usd
      }
    });
    appendLedgerEvent(db, llmFinish);

    const logicalPatchPath = `artifacts/${project_id}/${run_id}/${firstTask.id}/patch.diff`;
    const patchArtifact = writeArtifact(run_id, `patch_${firstTask.id}.diff`, mockPatch.patchText);
    db.exec(
      "UPDATE tasks SET patch_path = ?, patch_text = ?, cost_usd = ?, tokens_in = ?, tokens_out = ? WHERE run_id = ? AND plan_task_id = ?",
      [
        patchArtifact.path,
        mockPatch.patchText,
        cost.our_charge_usd,
        Math.round(tokensEstimate * 0.7),
        Math.round(tokensEstimate * 0.3),
        run_id,
        firstTask.id
      ]
    );
    db.exec("UPDATE runs SET cost_to_date = ?, current_task_id = ? WHERE id = ?", [
      cost.our_charge_usd,
      firstTask.id,
      run_id
    ]);

    const patchEvent = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      task_id: firstTask.id,
      event_type: "PATCH_PRODUCED",
      payload: { patch_path: logicalPatchPath }
    });
    appendLedgerEvent(db, patchEvent);

    emitTaskStage({
      run_id,
      task_id: firstTask.id,
      stage: "IMPLEMENT_PATCH",
      message: "Patch generated",
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id
    });

    events.emit(run_id, {
      type: "TASK_RESULT",
      ts: new Date().toISOString(),
      data: {
        patch_path: logicalPatchPath,
        patch_text: mockPatch.patchText,
        changed_files: mockPatch.changedFiles,
        verify_status: "pending",
        cost: {
          provider: cost.provider_cost_usd,
          charge: cost.our_charge_usd
        },
        tokens: {
          input: Math.round(tokensEstimate * 0.7),
          output: Math.round(tokensEstimate * 0.3)
        },
        risk_notes: [],
        rollback_notes: []
      }
    });

    emitTaskStage({
      run_id,
      task_id: firstTask.id,
      stage: "SELF_REVIEW",
      message: "Reviewing patch",
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id
    });

    emitTaskStage({
      run_id,
      task_id: firstTask.id,
      stage: "PROPOSE_APPLY",
      message: "Ready for /diff and /apply",
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id
    });

    const taskCompleted = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      task_id: firstTask.id,
      event_type: "TASK_COMPLETED",
      payload: { patch_path: logicalPatchPath }
    });
    appendLedgerEvent(db, taskCompleted);

    db.exec("UPDATE tasks SET state = ? WHERE run_id = ? AND plan_task_id = ?", [
      "DONE",
      run_id,
      firstTask.id
    ]);

    const sessionStats = computeSessionStats(run_id);
    if (sessionStats) {
      events.emit(run_id, {
        type: "SESSION_STATS",
        ts: new Date().toISOString(),
        data: { run_id, ...sessionStats }
      });
    }

    db.exec("UPDATE runs SET state = ? WHERE id = ?", ["DONE", run_id]);
    const runCompleted = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      event_type: "RUN_COMPLETED",
      payload: {}
    });
    appendLedgerEvent(db, runCompleted);

    const billingPosted = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      event_type: "BILLING_POSTED",
      payload: { charge_total: cost.our_charge_usd, provider_total: cost.provider_cost_usd }
    });
    appendLedgerEvent(db, billingPosted);

    reply.send({ run_id });
  });

  app.get("/v1/runs/:run_id/status", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    const run = db.query<Record<string, unknown>>("SELECT * FROM runs WHERE id = ?", [run_id])[0] as
      | { state: string; current_task_id: string; cost_to_date: number; budget_cap_usd: number }
      | undefined;

    if (!run) {
      reply.code(404).send({ error: "run not found" });
      return;
    }

    reply.send({
      state: run.state,
      current_task: run.current_task_id,
      cost_to_date: run.cost_to_date,
      budget_remaining: run.budget_cap_usd - run.cost_to_date
    });
  });

  app.get("/v1/projects/:id/runs", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const runs = db.query(
      "SELECT id, state, lane, risk, cost_to_date, budget_cap_usd, created_at FROM runs WHERE project_id = ? ORDER BY created_at DESC",
      [project_id]
    );
    reply.send({ runs });
  });

  app.post("/v1/runs/:run_id/pause", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    db.exec("UPDATE runs SET state = ? WHERE id = ?", ["PAUSED", run_id]);
    const run = db.query<Record<string, unknown>>("SELECT project_id, plan_id FROM runs WHERE id = ?", [run_id])[0] as
      | { project_id: string; plan_id: string }
      | undefined;
    if (run) {
      appendLedgerEvent(
        db,
        createLedgerEvent({
          org_id: auth.org_id,
          user_id: auth.user_id,
          project_id: run.project_id,
          run_id,
          plan_id: run.plan_id,
          event_type: "RUN_PAUSED",
          payload: { reason: "manual" }
        })
      );
    }
    reply.send({ ok: true });
  });

  app.post("/v1/runs/:run_id/resume", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    db.exec("UPDATE runs SET state = ? WHERE id = ?", ["RUNNING", run_id]);
    const run = db.query<Record<string, unknown>>("SELECT project_id, plan_id FROM runs WHERE id = ?", [run_id])[0] as
      | { project_id: string; plan_id: string }
      | undefined;
    if (run) {
      appendLedgerEvent(
        db,
        createLedgerEvent({
          org_id: auth.org_id,
          user_id: auth.user_id,
          project_id: run.project_id,
          run_id,
          plan_id: run.plan_id,
          event_type: "RUN_RESUMED",
          payload: { reason: "manual" }
        })
      );
    }
    reply.send({ ok: true });
  });

  app.post("/v1/runs/:run_id/cancel", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    db.exec("UPDATE runs SET state = ? WHERE id = ?", ["CANCELLED", run_id]);
    const run = db.query<Record<string, unknown>>("SELECT project_id, plan_id FROM runs WHERE id = ?", [run_id])[0] as
      | { project_id: string; plan_id: string }
      | undefined;
    if (run) {
      appendLedgerEvent(
        db,
        createLedgerEvent({
          org_id: auth.org_id,
          user_id: auth.user_id,
          project_id: run.project_id,
          run_id,
          plan_id: run.plan_id,
          event_type: "RUN_CANCELLED",
          payload: { reason: "manual" }
        })
      );
    }
    reply.send({ ok: true });
  });

  app.get("/v1/runs/:run_id/stream", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    events.attach(run_id, reply.raw);
  });

  app.post("/v1/runs/:run_id/verify", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    const body = (req.body ?? {}) as { mode?: "targeted" | "standard" | "strict"; target?: string };

    const run = db.query<Record<string, unknown>>("SELECT * FROM runs WHERE id = ?", [run_id])[0] as
      | { project_id: string; plan_id: string; lane: string; risk: string; current_task_id: string }
      | undefined;
    if (!run) {
      reply.code(404).send({ error: "run not found" });
      return;
    }

    if (!runnerBridge.hasRunner(run.project_id)) {
      reply.code(409).send({ error: "runner not connected" });
      return;
    }

    const verifyMode = body.mode ?? resolveVerifyMode(
      lanePolicy.lanes[run.lane as Lane].verify_mode,
      riskPolicy.risk_levels[run.risk as RiskLevel].verify_strictness
    );

    emitTaskStage({
      run_id,
      task_id: run.current_task_id,
      stage: "LOCAL_VERIFY",
      message: `verify mode: ${verifyMode}`,
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id: run.project_id,
      plan_id: run.plan_id
    });

    const verifyStart = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id: run.project_id,
      run_id,
      plan_id: run.plan_id,
      event_type: "VERIFY_STARTED",
      payload: { mode: verifyMode }
    });
    appendLedgerEvent(db, verifyStart);

    const gates = verifyGates.modes[verifyMode].gates;
    const results: Array<{ gate: string; exit_code: number; stdout: string; stderr: string }> = [];

    for (const gate of gates) {
      const command = verifyGates.commands[gate];
      const cmdStart = createLedgerEvent({
        org_id: auth.org_id,
        user_id: auth.user_id,
        project_id: run.project_id,
        run_id,
        plan_id: run.plan_id,
        event_type: "RUNNER_CMD_STARTED",
        payload: { command }
      });
      appendLedgerEvent(db, cmdStart);

      const result = await runnerBridge.sendExec({ project_id: run.project_id, cmd: command });
      results.push({ gate, exit_code: result.exit_code, stdout: result.stdout, stderr: result.stderr });

      const stderr = result.stderr ?? "";
      if (
        result.exit_code !== 0 &&
        (stderr.includes("Denied by permissions") || stderr.includes("User denied command"))
      ) {
        const reason = stderr.includes("User denied") ? "ask_denied" : "deny";
        appendLedgerEvent(
          db,
          createLedgerEvent({
            org_id: auth.org_id,
            user_id: auth.user_id,
            project_id: run.project_id,
            run_id,
            plan_id: run.plan_id,
            task_id: run.current_task_id,
            event_type: "RUNNER_CMD_BLOCKED",
            payload: { command, gate, reason }
          })
        );
        events.emit(run_id, {
          type: "PERMISSION_DENIED",
          ts: new Date().toISOString(),
          data: {
            run_id,
            task_id: run.current_task_id,
            command,
            gate,
            reason
          }
        });
      }

      const cmdFinish = createLedgerEvent({
        org_id: auth.org_id,
        user_id: auth.user_id,
        project_id: run.project_id,
        run_id,
        plan_id: run.plan_id,
        event_type: "RUNNER_CMD_FINISHED",
        payload: { command, exit_code: result.exit_code }
      });
      appendLedgerEvent(db, cmdFinish);
    }

    const allPassed = results.every((r) => r.exit_code === 0);
    const reportLines = [
      `# Verify Report (${verifyMode})`,
      "",
      body.target ? `Target: ${body.target}` : "",
      ...results.map((result) => `- ${result.gate}: ${result.exit_code === 0 ? "PASS" : "FAIL"}`)
    ];
    const report = reportLines.join("\n");
    const logicalReportPath = `artifacts/${run.project_id}/${run_id}/${run.current_task_id ?? "task"}/verify-report.md`;
    const reportArtifact = writeArtifact(run_id, "verify-report.md", report);

    const verifyFinish = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id: run.project_id,
      run_id,
      plan_id: run.plan_id,
      event_type: "VERIFY_FINISHED",
      payload: { status: allPassed ? "pass" : "fail", report_path: logicalReportPath }
    });
    appendLedgerEvent(db, verifyFinish);

    events.emit(run_id, {
      type: "VERIFY_FINISHED",
      ts: new Date().toISOString(),
      data: {
        run_id,
        task_id: run.current_task_id,
        status: allPassed ? "pass" : "fail",
        verify_report: logicalReportPath
      }
    });

    const sessionStats = computeSessionStats(run_id);
    if (sessionStats) {
      events.emit(run_id, {
        type: "SESSION_STATS",
        ts: new Date().toISOString(),
        data: { run_id, ...sessionStats }
      });
    }

    reply.send({
      status: allPassed ? "pass" : "fail",
      report_path: reportArtifact.path,
      gates: results
    });
  });

  app.get("/v1/usage/month", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const usage = computeUsageForMonth({ db, pricing, plan_id: auth.plan_id });
    reply.send(usage);
  });

  app.get("/v1/usage/today", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const usage = computeUsageForRange({ db, pricing, plan_id: auth.plan_id, start, end });
    reply.send({ ...usage, range: { start: start.toISOString(), end: end.toISOString() } });
  });

  app.get("/v1/invoice/preview", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const invoice = computeInvoicePreview({ db, pricing, plan_id: auth.plan_id });
    reply.send(invoice);
  });

  app.get("/v1/cost/explain", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const query = req.query as { task_id?: string; run_id?: string };
    if (!query.task_id && !query.run_id) {
      reply.code(400).send({ error: "task_id or run_id required" });
      return;
    }

    let row: { router_decision_json?: string } | undefined;
    if (query.task_id) {
      row = db.query<{ router_decision_json?: string }>(
        "SELECT router_decision_json FROM tasks WHERE plan_task_id = ?",
        [query.task_id]
      )[0];
    } else if (query.run_id) {
      row = db.query<{ router_decision_json?: string }>(
        "SELECT router_decision_json FROM tasks WHERE run_id = ?",
        [query.run_id]
      )[0];
    }

    if (!row?.router_decision_json) {
      reply.code(404).send({ error: "router decision not found" });
      return;
    }

    reply.send({ router_decision: JSON.parse(row.router_decision_json) });
  });

  app.get("/v1/projects/:id/plan/tasks", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const planRow = db.query<{ tasks_json: string }>(
      "SELECT tasks_json FROM plans WHERE project_id = ? AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1",
      [project_id]
    )[0];
    if (!planRow) {
      reply.code(404).send({ error: "no approved plan" });
      return;
    }
    reply.send(JSON.parse(planRow.tasks_json));
  });

  app.get("/v1/logs/tail", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const query = req.query as { run_id?: string; limit?: string };
    if (!query.run_id) {
      reply.code(400).send({ error: "run_id required" });
      return;
    }
    const limit = clampInt(Number(query.limit ?? 50), 1, 500);
    const rows = db.query<{ event_id: string; ts: string; event_type: string; payload_json?: string }>(
      "SELECT event_id, ts, event_type, payload_json FROM ledger_events WHERE run_id = ? ORDER BY ts DESC LIMIT ?",
      [query.run_id, limit]
    );
    reply.send({
      run_id: query.run_id,
      events: rows.map((row) => ({
        event_id: row.event_id,
        ts: row.ts,
        event_type: row.event_type,
        payload: JSON.parse(row.payload_json || "{}")
      }))
    });
  });

  app.get("/v1/ledger/export", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const rows = db.query<{
      event_id: string;
      ts: string;
      org_id: string;
      user_id: string;
      project_id: string;
      run_id?: string;
      plan_id?: string;
      task_id?: string;
      event_type: string;
      payload_json?: string;
    }>(
      "SELECT event_id, ts, org_id, user_id, project_id, run_id, plan_id, task_id, event_type, payload_json FROM ledger_events ORDER BY ts ASC"
    );
    const jsonl = rows
      .map((row) =>
        JSON.stringify({
          event_id: row.event_id,
          ts: row.ts,
          org_id: row.org_id,
          user_id: row.user_id,
          project_id: row.project_id,
          run_id: row.run_id,
          plan_id: row.plan_id,
          task_id: row.task_id,
          event_type: row.event_type,
          payload: JSON.parse(row.payload_json || "{}")
        })
      )
      .join("\n");
    reply.send(jsonl);
  });

  app.post("/v1/projects/:id/init", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { portable?: boolean; refresh?: boolean };
    const projectRow = db.query<{ repo_name?: string }>(
      "SELECT repo_name FROM projects WHERE id = ?",
      [project_id]
    )[0];
    const repoName = projectRow?.repo_name ?? path.basename(repoRoot);
    const policyNames = ["lane-policy.v1.yaml", "risk-policy.v1.yaml", "permissions.defaults.yaml"];

    let existingTrcoder: string | null = null;
    const existingFiles: Record<string, string> = {};
    if (runnerBridge.hasRunner(project_id)) {
      const filesToCheck = [
        ".trcoder/TRCODER.md",
        ".trcoder/rules/core.md",
        ".trcoder/agents/reviewer.md",
        ".trcoder/skills/verify/SKILL.md",
        ".trcoder/hooks.json",
        ".trcoder/templates/pr.md",
        ".trcoder/templates/adr.md",
        ...policyNames.map((name) => `.trcoder/policies/${name}`),
        ...(body.portable ? ["AGENTS.md"] : [])
      ];
      for (const rel of filesToCheck) {
        const readResult = await runnerBridge.sendRead({
          project_id,
          path: path.join(repoRoot, rel)
        });
        if (readResult.exit_code === 0) {
          existingFiles[rel.replace(/\\/g, "/")] = readResult.stdout ?? "";
        }
      }
      if (existingFiles[".trcoder/TRCODER.md"]) {
        existingTrcoder = existingFiles[".trcoder/TRCODER.md"];
      }
    }

    const policyFiles: Record<string, string> = {};
    for (const name of policyNames) {
      const filePath = path.join(repoRoot, "config", name);
      if (fs.existsSync(filePath)) {
        policyFiles[name] = fs.readFileSync(filePath, "utf8");
      } else {
        policyFiles[name] = `# Missing ${name}`;
      }
    }

    const { patchText } = buildOpsPackPatch({
      repoName,
      existingTrcoder,
      portable: body.portable,
      refresh: body.refresh,
      policyFiles,
      existingFiles
    });

    const artifact = writeArtifact(`init-${project_id}`, "init.patch.diff", patchText);
    reply.send({
      patch_path: `artifacts/${project_id}/init/patch.diff`,
      patch_text: patchText,
      artifact_path: artifact.path
    });
  });

  app.get("/v1/packs/:pack_id/stats", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;

    reply.send({
      pack_id: pack.pack_id,
      mode: pack.mode,
      budgets: pack.budgets,
      files_count: pack.file_entries.length,
      lines_estimate: Math.min(pack.budgets.max_lines, pack.file_entries.length * 100),
      pins: pack.pinned_sources.map((path) => ({ path, reason: "pinned" })),
      redaction: { masked_count: pack.redaction_stats.masked_entries },
      created_at: record.created_at
    });
  });

  app.post("/v1/packs/:pack_id/rebuild", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;

    const body = req.body as { budgets?: ContextPackManifest["budgets"]; pins?: string[] };
    let newPack = buildContextPack({
      runId: pack.run_id,
      taskId: pack.task_id,
      budgets: body.budgets ?? pack.budgets,
      pins: body.pins ?? pack.pinned_sources
    });
    newPack = await enrichContextPack(newPack, record.project_id);
    saveContextPack(db, { project_id: record.project_id, manifest: newPack });

    reply.send({
      old_pack_id: pack.pack_id,
      new_pack_id: newPack.pack_id,
      diff: {
        files_added: Math.max(0, newPack.file_entries.length - pack.file_entries.length),
        files_removed: Math.max(0, pack.file_entries.length - newPack.file_entries.length),
        lines_estimate_delta:
          Math.min(newPack.budgets.max_lines, newPack.file_entries.length * 100) -
          Math.min(pack.budgets.max_lines, pack.file_entries.length * 100)
      }
    });
  });

  app.post("/v1/packs/:pack_id/list", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;
    if (!runnerBridge.hasRunner(record.project_id)) {
      reply.code(409).send({ error: "runner not connected" });
      return;
    }

    const body = (req.body ?? {}) as { glob?: string; limit?: number };
    const limit = clampInt(Number(body.limit ?? 200), 1, 500);
    const result = await runnerBridge.sendList({
      project_id: record.project_id,
      glob: body.glob,
      root: repoRoot,
      limit
    });

    if (result.exit_code !== 0) {
      reply.code(500).send({ error: result.stderr || "list failed" });
      return;
    }
    const items = JSON.parse(result.stdout || "[]") as Array<{
      path: string;
      size: number;
      sha256?: string;
    }>;
    reply.send({ items: items.slice(0, limit), truncated: items.length > limit });
  });

  app.post("/v1/packs/:pack_id/read", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;
    if (!runnerBridge.hasRunner(record.project_id)) {
      reply.code(409).send({ error: "runner not connected" });
      return;
    }

    const body = req.body as { path: string; start_line?: number; end_line?: number };
    const result = await runnerBridge.sendRead({
      project_id: record.project_id,
      path: body.path,
      range: body.start_line && body.end_line ? { start_line: body.start_line, end_line: body.end_line } : undefined
    });

    if (result.exit_code !== 0) {
      reply.code(500).send({ error: result.stderr || "read failed" });
      return;
    }
    const redacted = redactText(result.stdout ?? "");
    if (redacted.masked_count > 0) {
      pack.redaction_stats.masked_entries += redacted.masked_count;
      pack.redaction_stats.masked_chars += redacted.masked_chars;
      updateContextPack(db, pack);
    }
    const limited = limitText(redacted.text);
    reply.send({
      path: body.path,
      start_line: body.start_line ?? 1,
      end_line: body.end_line ?? undefined,
      text: limited
    });
  });

  app.post("/v1/packs/:pack_id/search", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;
    if (!runnerBridge.hasRunner(record.project_id)) {
      reply.code(409).send({ error: "runner not connected" });
      return;
    }

    const body = req.body as { query: string; scope?: { paths?: string[] }; top_k?: number };
    const scope = body.scope?.paths?.[0] ?? process.cwd();
    const result = await runnerBridge.sendGrep({
      project_id: record.project_id,
      query: body.query,
      scope
    });
    if (result.exit_code !== 0) {
      reply.code(500).send({ error: result.stderr || "search failed" });
      return;
    }

    const lines = (result.stdout ?? "").split(/\r?\n/).filter(Boolean);
    const topK = clampInt(Number(body.top_k ?? 10), 1, 50);
    const matches = lines.slice(0, topK).map((line) => {
      const [pathPart, linePart] = line.split(":");
      const snippet = line.split(":").slice(2).join(":");
      const redacted = redactText(snippet);
      if (redacted.masked_count > 0) {
        pack.redaction_stats.masked_entries += redacted.masked_count;
        pack.redaction_stats.masked_chars += redacted.masked_chars;
      }
      return {
        path: pathPart,
        line: Number(linePart ?? 0),
        snippet: trimSnippet(redacted.text)
      };
    });
    if (pack.redaction_stats.masked_entries > 0) {
      updateContextPack(db, pack);
    }
    reply.send({ matches });
  });

  app.post("/v1/packs/:pack_id/diff", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;
    if (!runnerBridge.hasRunner(record.project_id)) {
      reply.code(409).send({ error: "runner not connected" });
      return;
    }

    const body = (req.body ?? {}) as { ref?: string; max_chars?: number };
    const ref = body.ref?.trim();
    const cmd = ref ? `git diff ${ref}` : "git diff";
    const result = await runnerBridge.sendExec({
      project_id: record.project_id,
      cmd,
      cwd: repoRoot
    });
    if (result.exit_code !== 0) {
      reply.code(500).send({ error: result.stderr || "diff failed" });
      return;
    }

    const redacted = redactText(result.stdout ?? "");
    if (redacted.masked_count > 0) {
      pack.redaction_stats.masked_entries += redacted.masked_count;
      pack.redaction_stats.masked_chars += redacted.masked_chars;
      updateContextPack(db, pack);
    }
    const maxChars = clampInt(Number(body.max_chars ?? MAX_CTX_CHARS), 200, 20000);
    reply.send({ diff: limitText(redacted.text, maxChars) });
  });

  app.post("/v1/packs/:pack_id/gitlog", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;
    if (!runnerBridge.hasRunner(record.project_id)) {
      reply.code(409).send({ error: "runner not connected" });
      return;
    }

    const body = (req.body ?? {}) as { n?: number };
    const n = clampInt(Number(body.n ?? 20), 1, 200);
    const cmd = `git log -n ${n} --oneline`;
    const result = await runnerBridge.sendExec({
      project_id: record.project_id,
      cmd,
      cwd: repoRoot
    });
    if (result.exit_code !== 0) {
      reply.code(500).send({ error: result.stderr || "git log failed" });
      return;
    }

    const redacted = redactText(result.stdout ?? "");
    if (redacted.masked_count > 0) {
      pack.redaction_stats.masked_entries += redacted.masked_count;
      pack.redaction_stats.masked_chars += redacted.masked_chars;
      updateContextPack(db, pack);
    }
    const entries = redacted.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, n)
      .map((line) => trimSnippet(line, 300));
    reply.send({ entries });
  });

  app.get("/v1/packs/:pack_id/failures", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;

    const row = db.query<{ payload_json?: string }>(
      "SELECT payload_json FROM ledger_events WHERE run_id = ? AND event_type = ? ORDER BY ts DESC LIMIT 1",
      [pack.run_id, "VERIFY_FINISHED"]
    )[0];

    if (!row?.payload_json) {
      reply.send({ status: "unknown", summary: "" });
      return;
    }

    const payload = JSON.parse(row.payload_json || "{}") as { status?: string; report_path?: string };
    const reportPath = path.join(getArtifactsDir(), `run-${pack.run_id}`, "verify-report.md");
    let summary = "";
    if (fs.existsSync(reportPath)) {
      const content = fs.readFileSync(reportPath, "utf8");
      const redacted = redactText(content);
      if (redacted.masked_count > 0) {
        pack.redaction_stats.masked_entries += redacted.masked_count;
        pack.redaction_stats.masked_chars += redacted.masked_chars;
        updateContextPack(db, pack);
      }
      summary = limitText(redacted.text, MAX_CTX_CHARS);
    }

    reply.send({
      status: payload.status ?? "unknown",
      report_path: payload.report_path ?? null,
      summary
    });
  });

  app.post("/v1/packs/:pack_id/logs", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;
    if (!runnerBridge.hasRunner(record.project_id)) {
      reply.code(409).send({ error: "runner not connected" });
      return;
    }

    const body = (req.body ?? {}) as { source?: string; tail?: number };
    const source = body.source ?? "";
    if (!source) {
      reply.code(400).send({ error: "source required" });
      return;
    }
    const tail = clampInt(Number(body.tail ?? MAX_LOG_LINES), 10, 1000);
    const resolved = path.isAbsolute(source) ? source : path.join(repoRoot, source);
    const result = await runnerBridge.sendRead({
      project_id: record.project_id,
      path: resolved
    });
    if (result.exit_code !== 0) {
      reply.code(500).send({ error: result.stderr || "log read failed" });
      return;
    }

    const redacted = redactText(result.stdout ?? "");
    if (redacted.masked_count > 0) {
      pack.redaction_stats.masked_entries += redacted.masked_count;
      pack.redaction_stats.masked_chars += redacted.masked_chars;
      updateContextPack(db, pack);
    }
    const lines = tailLines(redacted.text, tail).map((line) => trimSnippet(line, 500));
    reply.send({ source, tail, lines });
  });

  return { app, db };
}
