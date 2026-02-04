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
import { getProviderFactory } from "./providers";
import { RunEventHub } from "./run-events";
import { appendLedgerEvent, listLedgerEvents } from "./ledger-store";
import { RunnerBridge } from "./runner-bridge";
import { computeInvoicePreview, computeUsageForMonth, computeUsageForRange } from "./billing";
import { redactText } from "./redaction";
import { getArtifactsDir } from "./storage";
import { buildOpsPackPatch } from "./ops-pack";
import { generateTasksForPlan } from "./planner";
import { parseJsonValue } from "./utils/json";
import { GitHubAdapter } from "./pr-adapters";

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

function isSafePin(pin: string): boolean {
  const trimmed = pin.trim();
  if (!trimmed) return false;

  // Pins must be repo-relative paths/globs (no absolute paths).
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    trimmed.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  ) {
    return false;
  }

  // Prevent parent traversal and other surprising inputs.
  if (trimmed.includes("..")) return false;

  const lower = trimmed.toLowerCase();
  // Avoid accidentally pinning OS/user temp folders or obvious secret files.
  if (lower.includes("appdata") || lower.includes("temp") || lower.includes("tmp")) return false;
  if (
    lower.includes("secret") ||
    lower.includes("token") ||
    lower.includes("apikey") ||
    lower.includes("api_key") ||
    lower.includes("password")
  ) {
    return false;
  }
  if (
    lower === ".env" ||
    lower.endsWith("/.env") ||
    lower.endsWith("\\.env") ||
    lower.includes("/.env.") ||
    lower.includes("\\.env.")
  ) {
    return false;
  }

  return true;
}

function sanitizePins(pins: string[]): { pins: string[]; droppedCount: number } {
  const out: string[] = [];
  let droppedCount = 0;
  for (const raw of pins) {
    const pin = (raw ?? "").trim();
    if (!pin) continue;
    if (!isSafePin(pin)) {
      droppedCount += 1;
      continue;
    }
    if (!out.includes(pin)) out.push(pin);
  }
  return { pins: out, droppedCount };
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
  return regex.test(value);
}

function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i);
  if (sshUrlMatch) {
    return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] };
  }
  return null;
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
  app.addHook("onClose", async () => {
    await db.close();
  });
  const events = new RunEventHub();
  const providerFactory = getProviderFactory({
    fallbackChains: modelStack.fallback_chains,
    useMock: process.env.TRCODER_USE_MOCK_PROVIDER === "true"
  });
  const runnerBridge = new RunnerBridge(
    app.server,
    permissions,
    async (req) => {
      const auth = req.headers["authorization"];
      const projectHeader = req.headers["x-trcoder-project"];
      if (!auth || !auth.toString().startsWith("Bearer ")) {
        return null;
      }
      const api_key = auth.toString().slice("Bearer ".length);
      const record = (
        await db.query<{ org_id: string; user_id: string }>(
          "SELECT org_id, user_id FROM api_keys WHERE key = ?",
          [api_key]
        )
      )[0];
      if (!record || !projectHeader) {
        return null;
      }
      const project_id = projectHeader.toString();
      const project = (await db.query("SELECT id FROM projects WHERE id = ?", [project_id]))[0];
      if (!project) {
        return null;
      }
      return { project_id, org_id: record.org_id, user_id: record.user_id };
    },
    async (req, reason) => {
      const projectHeader = req.headers["x-trcoder-project"];
      const project_id = projectHeader ? projectHeader.toString() : "unknown";
      await appendLedgerEvent(
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

  async function computeSessionStats(runId: string) {
    const run = (await db.query<Record<string, unknown>>("SELECT * FROM runs WHERE id = ?", [runId]))[0] as
      | { created_at: string; cost_to_date: number | string; budget_cap_usd: number | string; plan_id: string }
      | undefined;
    if (!run) return null;

    const planRow = (await db.query<{ tasks_json?: unknown }>(
      "SELECT tasks_json FROM plans WHERE id = ?",
      [run.plan_id]
    ))[0];
    const tasksFile = parseJsonValue<TasksFileV1 | null>(planRow?.tasks_json, null);
    const tasks_total = tasksFile ? getPlanTasksCount(tasksFile) : 0;
    const tasksCompletedRow = (await db.query<{ cnt: number | string }>(
      "SELECT COUNT(1) as cnt FROM tasks WHERE run_id = ? AND state = ?",
      [runId, "DONE"]
    ))[0];
    const tasks_completed = Number(tasksCompletedRow?.cnt ?? 0);

    const events = (await listLedgerEvents(db, "1970-01-01T00:00:00.000Z", new Date().toISOString())).filter(
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

    const cost_to_date = Number(run.cost_to_date ?? 0);
    const budget_cap_usd = Number(run.budget_cap_usd ?? 0);
    const elapsed = Math.max(0, Date.now() - new Date(run.created_at).getTime());
    return {
      time_elapsed_sec: Math.round(elapsed / 1000),
      tasks_completed,
      tasks_total,
      cost_to_date_usd: cost_to_date,
      budget_remaining_usd: budget_cap_usd - cost_to_date,
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

  async function emitTaskStage(input: {
    run_id: string;
    task_id: string;
    stage: string;
    message: string;
    org_id: string;
    user_id: string;
    project_id: string;
    plan_id: string;
  }): Promise<void> {
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

    await appendLedgerEvent(
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

  async function requireAuth(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<AuthContext | null> {
    const auth = req.headers["authorization"];
    if (!auth || !auth.toString().startsWith("Bearer ")) {
      reply.code(401).send({ error: "missing api key" });
      return null;
    }
    const api_key = auth.toString().slice("Bearer ".length);
    const record = (await db.query<Record<string, string>>(
      "SELECT * FROM api_keys WHERE key = ?",
      [api_key]
    ))[0] as
      | { key: string; org_id: string; user_id: string; plan_id: string }
      | undefined;
    if (!record) {
      reply.code(401).send({ error: "invalid api key" });
      return null;
    }
    return { api_key, org_id: record.org_id, user_id: record.user_id, plan_id: record.plan_id };
  }

  app.post("/v1/projects/connect", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const body = req.body as { repo_name: string; repo_root_hash: string };
    const repo_name = String(body.repo_name ?? "").trim();
    const repo_root_hash = String(body.repo_root_hash ?? "").trim();
    if (!repo_name || !repo_root_hash) {
      reply.code(400).send({ error: "repo_name and repo_root_hash required" });
      return;
    }

    // Idempotent connect: repo_root_hash is treated as the stable repo identity.
    const existing = (await db.query<{ id: string }>(
      "SELECT id FROM projects WHERE repo_root_hash = ? ORDER BY created_at DESC LIMIT 1",
      [repo_root_hash]
    ))[0];
    if (existing?.id) {
      reply.send({ project_id: existing.id });
      return;
    }

    const project_id = randomUUID();
    await db.exec(
      "INSERT INTO projects (id, repo_name, repo_root_hash, created_at) VALUES (?, ?, ?, ?)",
      [project_id, repo_name, repo_root_hash, new Date().toISOString()]
    );

    reply.send({ project_id });
  });

  app.get("/v1/whoami", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const usage = await computeUsageForMonth({ db, pricing, plan_id: auth.plan_id });
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const project_id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as {
      input?: { text?: string; files?: Array<{ path: string; content: string }> };
      pins?: string[];
      lane?: Lane;
      risk?: RiskLevel;
      budget_cap_usd?: number;
    };

    const projectRow = (await db.query<{ repo_name?: string }>(
      "SELECT repo_name FROM projects WHERE id = ?",
      [project_id]
    ))[0];
    if (!projectRow) {
      reply.code(404).send({ error: "project not found" });
      return;
    }

    const plan_id = `plan_${Date.now()}`;
    const sanitized = sanitizePins((body.pins ?? []).filter(Boolean));
    const pins = sanitized.pins;
    const warnings: string[] = [];
    if (sanitized.droppedCount > 0) {
      warnings.push(
        `Dropped ${sanitized.droppedCount} unsafe pin(s). Pins must be repo-relative paths/globs and should not target secrets.`
      );
    }

    const lane: Lane =
      body.lane && lanePolicy.lanes[body.lane as Lane] ? (body.lane as Lane) : "balanced";
    const risk: RiskLevel =
      body.risk && riskPolicy.risk_levels[body.risk as RiskLevel]
        ? (body.risk as RiskLevel)
        : "standard";
    const budget_cap_usd = typeof body.budget_cap_usd === "number" ? body.budget_cap_usd : undefined;

    const redText = redactText((body.input?.text ?? "").trim());
    const inputText = redText.text;
    const inputFiles = (body.input?.files ?? [])
      .filter((f) => Boolean(f?.path))
      .map((f) => ({
        path: String(f.path ?? ""),
        content: limitText(redactText(String(f.content ?? "")).text, 20000)
      }))
      .filter((f) => f.path);
    const pinnedFiles = inputFiles.map((f) => f.path).filter(Boolean);

    const projectName = (projectRow.repo_name ?? "project").trim() || "project";

    const contextBudget = lanePolicy.lanes[lane]?.context_budget ?? lanePolicy.lanes.balanced.context_budget;
    const plannerDecision = decideRouter({
      taskType: "project_planning",
      lane,
      risk,
      budgetRemainingUsd: budget_cap_usd,
      contextBudget,
      modelStack,
      lanePolicy,
      riskPolicy
    });
    const plannerProviderSelection = await providerFactory.getProviderWithFallback(plannerDecision.selected_model);

    const planningRequestText =
      inputText ||
      (inputFiles.length > 0 ? inputFiles.map((f) => `# ${f.path}\n\n${f.content}`).join("\n\n") : "");

    const allowedTaskTypes = Object.keys(modelStack.task_type_map ?? {});
    const taskGen = await generateTasksForPlan({
      provider: plannerProviderSelection.provider,
      model: plannerProviderSelection.selectedModel,
      planId: plan_id,
      projectName,
      requestText: planningRequestText,
      inputFiles,
      lane,
      risk,
      allowedTaskTypes
    });

    if (taskGen.warnings.length > 0) {
      warnings.push(...taskGen.warnings);
    }

    const tasks = taskGen.tasks;

    // Preview how routing will split responsibility across models for this plan.
    const routingLines = tasks.phases
      .flatMap((phase) =>
        phase.tasks.map((task) => {
          const d = decideRouter({
            taskType: task.type,
            lane,
            risk,
            budgetRemainingUsd: budget_cap_usd,
            contextBudget,
            modelStack,
            lanePolicy,
            riskPolicy
          });
          return `- [${phase.id}] ${task.id}: ${task.title} (${task.type}, risk=${task.risk}) -> ${d.selected_model}`;
        })
      )
      .join("\n");

    const planMd = [
      `# Plan ${plan_id}`,
      "",
      `Generated by TRCODER planner (V1). Source: ${taskGen.source}.`,
      "",
      "## Router Roles (preview)",
      `- planner: project_planning -> ${plannerDecision.selected_model} (actual: ${plannerProviderSelection.selectedModel})`,
      "",
      inputText ? "## Request" : null,
      inputText ? inputText : null,
      "",
      warnings.length > 0 ? "## Warnings" : null,
      warnings.length > 0 ? warnings.map((w) => `- ${w}`).join("\n") : null,
      "",
      pins.length > 0 ? "## Pins" : null,
      pins.length > 0 ? pins.map((p) => `- ${p}`).join("\n") : null,
      "",
      pinnedFiles.length > 0 ? "## Input Files" : null,
      pinnedFiles.length > 0 ? pinnedFiles.map((p) => `- ${p}`).join("\n") : null,
      "",
      "## Tasks",
      routingLines || "- (no tasks)",
      ""
    ]
      .filter((line) => line !== null)
      .join("\n");

    const risksMd = [
      "# Risks",
      "",
      "- Mock risk list (V1).",
      "- Real risk generation will be model-driven later."
    ].join("\n");

    const planArtifact = writePlanArtifact(plan_id, "plan.md", planMd);
    const tasksArtifact = writePlanArtifact(plan_id, "tasks.v1.json", JSON.stringify(tasks, null, 2));
    const risksArtifact = writePlanArtifact(plan_id, "risks.md", risksMd);

    const artifacts = [
      { path: `artifacts/${project_id}/${plan_id}/plan.md`, kind: "plan.md" },
      { path: `artifacts/${project_id}/${plan_id}/tasks.v1.json`, kind: "tasks.v1.json" },
      { path: `artifacts/${project_id}/${plan_id}/risks.md`, kind: "risks.md" }
    ];

    if (taskGen.usage) {
      const usageSoFar = await computeUsageForMonth({ db, pricing, plan_id: auth.plan_id });
      const creditsRemaining = Math.max(
        0,
        (pricing.plans[auth.plan_id]?.included_credits_trc ?? 0) - usageSoFar.credits_used
      );

      const tokensEstimate = estimateTokens("project_planning", lane, risk);
      const tokensIn =
        typeof taskGen.usage?.prompt_tokens === "number"
          ? taskGen.usage.prompt_tokens
          : Math.round(tokensEstimate * 0.7);
      const tokensOut =
        typeof taskGen.usage?.completion_tokens === "number"
          ? taskGen.usage.completion_tokens
          : Math.round(tokensEstimate * 0.3);

      const cost = calculateCost({
        model: plannerProviderSelection.selectedModel,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        pricing,
        modelStack,
        plan_id: auth.plan_id,
        credits_remaining_trc: creditsRemaining
      });

      await appendLedgerEvent(
        db,
        createLedgerEvent({
          org_id: auth.org_id,
          user_id: auth.user_id,
          project_id,
          plan_id,
          event_type: "LLM_CALL_STARTED",
          payload: {
            model: plannerProviderSelection.selectedModel,
            requested_model: plannerDecision.selected_model,
            provider: plannerProviderSelection.provider.name,
            used_fallback: plannerProviderSelection.usedFallback,
            task_type: "plan"
          }
        })
      );

      await appendLedgerEvent(
        db,
        createLedgerEvent({
          org_id: auth.org_id,
          user_id: auth.user_id,
          project_id,
          plan_id,
          event_type: "LLM_CALL_FINISHED",
          payload: {
            model: plannerProviderSelection.selectedModel,
            requested_model: plannerDecision.selected_model,
            provider: plannerProviderSelection.provider.name,
            used_fallback: plannerProviderSelection.usedFallback,
            task_type: "plan",
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            provider_cost_usd: cost.provider_cost_usd,
            credits_applied_usd: cost.credits_applied_usd,
            billable_provider_cost_usd: cost.billable_provider_cost_usd,
            markup_rate: cost.markup_rate,
            our_charge_usd: cost.our_charge_usd
          }
        })
      );
    }

    await db.exec(
      "INSERT INTO plans (id, project_id, created_at, approved_at, repo_commit, artifacts_json, tasks_json, input_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        plan_id,
        project_id,
        new Date().toISOString(),
        null,
        null,
        JSON.stringify(artifacts),
        JSON.stringify(tasks),
        JSON.stringify({
          input: {
            text: inputText,
            files: pinnedFiles.map((p) => ({ path: p }))
          },
          pins
        })
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
    await appendLedgerEvent(db, planEvent);

    reply.send({ plan_id, artifacts, plan_md: planMd, risks_md: risksMd, tasks });
  });

  app.post("/v1/projects/:id/chat", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const project_id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as {
      message?: string;
      messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      lane?: Lane;
      risk?: RiskLevel;
      budget_cap_usd?: number;
    };

    const project = (await db.query("SELECT id FROM projects WHERE id = ?", [project_id]))[0];
    if (!project) {
      reply.code(404).send({ error: "project not found" });
      return;
    }

    const lane: Lane =
      body.lane && lanePolicy.lanes[body.lane as Lane] ? (body.lane as Lane) : "balanced";
    const risk: RiskLevel =
      body.risk && riskPolicy.risk_levels[body.risk as RiskLevel]
        ? (body.risk as RiskLevel)
        : "standard";
    const budget_cap_usd = typeof body.budget_cap_usd === "number" ? body.budget_cap_usd : undefined;

    const rawMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
      Array.isArray(body.messages) && body.messages.length > 0
        ? body.messages
        : typeof body.message === "string" && body.message.trim().length > 0
          ? [{ role: "user", content: body.message }]
          : [];

    const history = rawMessages
      .filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          Boolean(m) &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0
      )
      .map((m) => {
        const red = redactText(m.content);
        return { role: m.role, content: limitText(red.text, 8000) };
      })
      .slice(-20);

    if (history.length === 0) {
      reply.code(400).send({ error: "message required" });
      return;
    }
    if (history[history.length - 1].role !== "user") {
      reply.code(400).send({ error: "last message must be user" });
      return;
    }

    const contextBudget = lanePolicy.lanes[lane]?.context_budget ?? lanePolicy.lanes.balanced.context_budget;
    const routerDecision = decideRouter({
      taskType: "project_planning",
      lane,
      risk,
      budgetRemainingUsd: budget_cap_usd,
      contextBudget,
      modelStack,
      lanePolicy,
      riskPolicy
    });

    const providerSelection = await providerFactory.getProviderWithFallback(routerDecision.selected_model);

    const llmStart = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      event_type: "LLM_CALL_STARTED",
      payload: {
        model: providerSelection.selectedModel,
        requested_model: routerDecision.selected_model,
        provider: providerSelection.provider.name,
        used_fallback: providerSelection.usedFallback,
        task_type: "chat"
      }
    });
    await appendLedgerEvent(db, llmStart);

    const systemPrompt =
      "You are TRCODER interactive shell assistant. Be concise and practical. " +
      "Do not claim to have applied changes unless the user ran /apply. " +
      "Respect patch-first: suggest /plan and /start for execution.";

    const completion = await providerSelection.provider.chat({
      model: providerSelection.selectedModel,
      messages: [{ role: "system", content: systemPrompt }, ...history],
      temperature: 0.2
    });

    const usageSoFar = await computeUsageForMonth({ db, pricing, plan_id: auth.plan_id });
    const creditsRemaining = Math.max(
      0,
      (pricing.plans[auth.plan_id]?.included_credits_trc ?? 0) - usageSoFar.credits_used
    );

    const tokensEstimate = estimateTokens("project_planning", lane, risk);
    const tokensIn =
      typeof completion.usage?.prompt_tokens === "number"
        ? completion.usage.prompt_tokens
        : Math.round(tokensEstimate * 0.7);
    const tokensOut =
      typeof completion.usage?.completion_tokens === "number"
        ? completion.usage.completion_tokens
        : Math.round(tokensEstimate * 0.3);

    const cost = calculateCost({
      model: providerSelection.selectedModel,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      pricing,
      modelStack,
      plan_id: auth.plan_id,
      credits_remaining_trc: creditsRemaining
    });

    const llmFinish = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      event_type: "LLM_CALL_FINISHED",
      payload: {
        model: providerSelection.selectedModel,
        requested_model: routerDecision.selected_model,
        provider: providerSelection.provider.name,
        used_fallback: providerSelection.usedFallback,
        task_type: "chat",
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        provider_cost_usd: cost.provider_cost_usd,
        credits_applied_usd: cost.credits_applied_usd,
        billable_provider_cost_usd: cost.billable_provider_cost_usd,
        markup_rate: cost.markup_rate,
        our_charge_usd: cost.our_charge_usd
      }
    });
    await appendLedgerEvent(db, llmFinish);

    reply.send({
      message: completion.content,
      model: providerSelection.selectedModel,
      requested_model: routerDecision.selected_model,
      provider: providerSelection.provider.name,
      used_fallback: providerSelection.usedFallback,
      tokens: { input: tokensIn, output: tokensOut },
      cost: {
        provider_cost_usd: cost.provider_cost_usd,
        credits_applied_usd: cost.credits_applied_usd,
        billable_provider_cost_usd: cost.billable_provider_cost_usd,
        our_charge_usd: cost.our_charge_usd
      }
    });
  });

  app.post("/v1/projects/:id/plan/approve", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const body = req.body as { plan_id: string; repo_commit: string };

    await db.exec("UPDATE plans SET approved_at = ?, repo_commit = ? WHERE id = ? AND project_id = ?", [
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
    await appendLedgerEvent(db, event);

    reply.send({ ok: true });
  });

  app.get("/v1/projects/:id/plan/status", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;

    const latest = (await db.query<{ id?: string; repo_commit?: string }>(
      "SELECT id, repo_commit FROM plans WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
      [project_id]
    ))[0];
    const approved = (await db.query<{ id?: string; repo_commit?: string }>(
      "SELECT id, repo_commit FROM plans WHERE project_id = ? AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1",
      [project_id]
    ))[0];

    const repoState = await getRepoState(project_id);
    const staleInfo = computeStale(approved?.repo_commit, repoState);

    await appendLedgerEvent(
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
    const auth = await requireAuth(req, reply);
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

    const planRow = (await db.query<{ id: string; tasks_json: unknown; input_json: unknown; repo_commit?: string }>(
      "SELECT id, tasks_json, input_json, repo_commit FROM plans WHERE project_id = ? AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1",
      [project_id]
    ))[0];

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

    await db.exec(
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

    const tasks = parseJsonValue<TasksFileV1 | null>(planRow.tasks_json, null);
    if (!tasks) {
      reply.code(500).send({ error: "invalid tasks payload" });
      return;
    }
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

    await db.exec(
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
    await appendLedgerEvent(db, runEvent);

    await emitTaskStage({
      run_id,
      task_id: firstTask.id,
      stage: "PREPARE_CONTEXT",
      message: "Building context pack",
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id
    });

    const inputMeta = parseJsonValue<{ pins?: string[] }>(planRow.input_json, {});
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

    const lastVerify = (await db.query<{ payload_json?: unknown }>(
      "SELECT payload_json FROM ledger_events WHERE project_id = ? AND event_type = ? ORDER BY ts DESC LIMIT 1",
      [project_id, "VERIFY_FINISHED"]
    ))[0];
    if (lastVerify?.payload_json) {
      const payload = parseJsonValue<{ status?: string; report_path?: string }>(lastVerify.payload_json, {});
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
    await saveContextPack(db, { project_id, manifest: contextPack });

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
    await appendLedgerEvent(db, ctxEvent);

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

    await db.exec("UPDATE tasks SET router_decision_json = ? WHERE run_id = ? AND plan_task_id = ?", [
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
    await appendLedgerEvent(db, routerEvent);

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

      await db.exec("UPDATE runs SET state = ? WHERE id = ?", ["PAUSED", run_id]);
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
      await appendLedgerEvent(db, anomaly);

      const paused = createLedgerEvent({
        org_id: auth.org_id,
        user_id: auth.user_id,
        project_id,
        run_id,
        plan_id,
        event_type: "RUN_PAUSED",
        payload: { reason: "budget" }
      });
      await appendLedgerEvent(db, paused);

      reply.send({ run_id });
      return;
    }

    let providerSelection: Awaited<ReturnType<typeof providerFactory.getProviderWithFallback>>;
    try {
      providerSelection = await providerFactory.getProviderWithFallback(routerDecision.selected_model);
    } catch (err) {
      events.emit(run_id, {
        type: "ANOMALY",
        ts: new Date().toISOString(),
        data: {
          expected_p90: routerDecision.expected_cost_usd,
          actual: 0,
          reason: "provider unavailable",
          action: "paused",
          suggestions: ["/lane set cost-saver", "/context trim"]
        }
      });
      await db.exec("UPDATE runs SET state = ? WHERE id = ?", ["PAUSED", run_id]);
      await appendLedgerEvent(
        db,
        createLedgerEvent({
          org_id: auth.org_id,
          user_id: auth.user_id,
          project_id,
          run_id,
          plan_id,
          task_id: firstTask.id,
          event_type: "ANOMALY_DETECTED",
          payload: { reason: "provider_unavailable", error: (err as Error).message }
        })
      );
      reply.code(503).send({ error: "provider_unavailable" });
      return;
    }

    const taskStartedEvent = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      task_id: firstTask.id,
      event_type: "TASK_STARTED",
      payload: {
        task_id: firstTask.id,
        title: firstTask.title,
        type: firstTask.type,
        risk: firstTask.risk,
        provider: providerSelection.provider.name,
        selected_model: providerSelection.selectedModel,
        requested_model: routerDecision.selected_model,
        used_fallback: providerSelection.usedFallback
      }
    });
    await appendLedgerEvent(db, taskStartedEvent);

    events.emit(run_id, {
      type: "TASK_STARTED",
      ts: new Date().toISOString(),
      data: {
        task_id: firstTask.id,
        title: firstTask.title,
        task_type: firstTask.type,
        selected_model: providerSelection.selectedModel,
        requested_model: routerDecision.selected_model,
        provider: providerSelection.provider.name,
        used_fallback: providerSelection.usedFallback,
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

    await emitTaskStage({
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
      payload: {
        model: providerSelection.selectedModel,
        requested_model: routerDecision.selected_model,
        provider: providerSelection.provider.name,
        used_fallback: providerSelection.usedFallback
      }
    });
    await appendLedgerEvent(db, llmStart);

    const patchResult = await providerSelection.provider.generatePatch({ task_id: firstTask.id });
    const usageSoFar = await computeUsageForMonth({ db, pricing, plan_id: auth.plan_id });
    const creditsRemaining = Math.max(
      0,
      (pricing.plans[auth.plan_id]?.included_credits_trc ?? 0) - usageSoFar.credits_used
    );
    const tokensIn =
      typeof patchResult.usage?.prompt_tokens === "number"
        ? patchResult.usage.prompt_tokens
        : Math.round(tokensEstimate * 0.7);
    const tokensOut =
      typeof patchResult.usage?.completion_tokens === "number"
        ? patchResult.usage.completion_tokens
        : Math.round(tokensEstimate * 0.3);
    const cost = calculateCost({
      model: providerSelection.selectedModel,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
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
        model: providerSelection.selectedModel,
        requested_model: routerDecision.selected_model,
        provider: providerSelection.provider.name,
        used_fallback: providerSelection.usedFallback,
        task_type: firstTask.type,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        provider_cost_usd: cost.provider_cost_usd,
        credits_applied_usd: cost.credits_applied_usd,
        billable_provider_cost_usd: cost.billable_provider_cost_usd,
        markup_rate: cost.markup_rate,
        our_charge_usd: cost.our_charge_usd
      }
    });
    await appendLedgerEvent(db, llmFinish);

    const logicalPatchPath = `artifacts/${project_id}/${run_id}/${firstTask.id}/patch.diff`;
    const patchArtifact = writeArtifact(run_id, `patch_${firstTask.id}.diff`, patchResult.patchText);
    await db.exec(
      "UPDATE tasks SET patch_path = ?, patch_text = ?, cost_usd = ?, tokens_in = ?, tokens_out = ? WHERE run_id = ? AND plan_task_id = ?",
      [
        patchArtifact.path,
        patchResult.patchText,
        cost.our_charge_usd,
        tokensIn,
        tokensOut,
        run_id,
        firstTask.id
      ]
    );
    await db.exec("UPDATE runs SET cost_to_date = ?, current_task_id = ? WHERE id = ?", [
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
    await appendLedgerEvent(db, patchEvent);

    await emitTaskStage({
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
        patch_text: patchResult.patchText,
        changed_files: patchResult.changedFiles,
        verify_status: "pending",
        cost: {
          provider: cost.provider_cost_usd,
          charge: cost.our_charge_usd
        },
        tokens: {
          input: tokensIn,
          output: tokensOut
        },
        risk_notes: [],
        rollback_notes: []
      }
    });

    await emitTaskStage({
      run_id,
      task_id: firstTask.id,
      stage: "SELF_REVIEW",
      message: "Reviewing patch",
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      plan_id
    });

    await emitTaskStage({
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
    await appendLedgerEvent(db, taskCompleted);

    await db.exec("UPDATE tasks SET state = ? WHERE run_id = ? AND plan_task_id = ?", [
      "DONE",
      run_id,
      firstTask.id
    ]);

    const sessionStats = await computeSessionStats(run_id);
    if (sessionStats) {
      events.emit(run_id, {
        type: "SESSION_STATS",
        ts: new Date().toISOString(),
        data: { run_id, ...sessionStats }
      });
    }

    await db.exec("UPDATE runs SET state = ? WHERE id = ?", ["DONE", run_id]);
    const runCompleted = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      event_type: "RUN_COMPLETED",
      payload: {}
    });
    await appendLedgerEvent(db, runCompleted);

    const billingPosted = createLedgerEvent({
      org_id: auth.org_id,
      user_id: auth.user_id,
      project_id,
      run_id,
      plan_id,
      event_type: "BILLING_POSTED",
      payload: { charge_total: cost.our_charge_usd, provider_total: cost.provider_cost_usd }
    });
    await appendLedgerEvent(db, billingPosted);

    reply.send({ run_id });
  });

  app.get("/v1/runs/:run_id/status", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    const run = (await db.query<Record<string, unknown>>("SELECT * FROM runs WHERE id = ?", [run_id]))[0] as
      | { state: string; current_task_id: string; cost_to_date: number | string; budget_cap_usd: number | string }
      | undefined;

    if (!run) {
      reply.code(404).send({ error: "run not found" });
      return;
    }

    const cost_to_date = Number(run.cost_to_date ?? 0);
    const budget_cap_usd = Number(run.budget_cap_usd ?? 0);
    reply.send({
      state: run.state,
      current_task: run.current_task_id,
      cost_to_date,
      budget_remaining: budget_cap_usd - cost_to_date
    });
  });

  app.get("/v1/projects/:id/runs", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const runs = await db.query(
      "SELECT id, state, lane, risk, cost_to_date, budget_cap_usd, created_at FROM runs WHERE project_id = ? ORDER BY created_at DESC",
      [project_id]
    );
    const normalized = runs.map((row: any) => ({
      ...row,
      cost_to_date: Number(row.cost_to_date ?? 0),
      budget_cap_usd: Number(row.budget_cap_usd ?? 0)
    }));
    reply.send({ runs: normalized });
  });

  app.post("/v1/runs/:run_id/pause", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    await db.exec("UPDATE runs SET state = ? WHERE id = ?", ["PAUSED", run_id]);
    const run = (await db.query<Record<string, unknown>>("SELECT project_id, plan_id FROM runs WHERE id = ?", [run_id]))[0] as
      | { project_id: string; plan_id: string }
      | undefined;
    if (run) {
      await appendLedgerEvent(
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    await db.exec("UPDATE runs SET state = ? WHERE id = ?", ["RUNNING", run_id]);
    const run = (await db.query<Record<string, unknown>>("SELECT project_id, plan_id FROM runs WHERE id = ?", [run_id]))[0] as
      | { project_id: string; plan_id: string }
      | undefined;
    if (run) {
      await appendLedgerEvent(
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    await db.exec("UPDATE runs SET state = ? WHERE id = ?", ["CANCELLED", run_id]);
    const run = (await db.query<Record<string, unknown>>("SELECT project_id, plan_id FROM runs WHERE id = ?", [run_id]))[0] as
      | { project_id: string; plan_id: string }
      | undefined;
    if (run) {
      await appendLedgerEvent(
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    events.attach(run_id, reply.raw);
  });

  async function executeVerify(input: {
    auth: AuthContext;
    run_id: string;
    run: { project_id: string; plan_id: string; lane: string; risk: string; current_task_id: string };
    mode?: "targeted" | "standard" | "strict";
    target?: string;
  }): Promise<{
    status: "pass" | "fail";
    report_path: string;
    gates: Array<{ gate: string; exit_code: number; stdout: string; stderr: string }>;
  }> {
    const verifyMode = input.mode ?? resolveVerifyMode(
      lanePolicy.lanes[input.run.lane as Lane].verify_mode,
      riskPolicy.risk_levels[input.run.risk as RiskLevel].verify_strictness
    );

    await emitTaskStage({
      run_id: input.run_id,
      task_id: input.run.current_task_id,
      stage: "LOCAL_VERIFY",
      message: `verify mode: ${verifyMode}`,
      org_id: input.auth.org_id,
      user_id: input.auth.user_id,
      project_id: input.run.project_id,
      plan_id: input.run.plan_id
    });

    const verifyStart = createLedgerEvent({
      org_id: input.auth.org_id,
      user_id: input.auth.user_id,
      project_id: input.run.project_id,
      run_id: input.run_id,
      plan_id: input.run.plan_id,
      event_type: "VERIFY_STARTED",
      payload: { mode: verifyMode }
    });
    await appendLedgerEvent(db, verifyStart);

    const gates = verifyGates.modes[verifyMode].gates;
    const results: Array<{ gate: string; exit_code: number; stdout: string; stderr: string }> = [];

    for (const gate of gates) {
      const command = verifyGates.commands[gate];
      const cmdStart = createLedgerEvent({
        org_id: input.auth.org_id,
        user_id: input.auth.user_id,
        project_id: input.run.project_id,
        run_id: input.run_id,
        plan_id: input.run.plan_id,
        event_type: "RUNNER_CMD_STARTED",
        payload: { command }
      });
      await appendLedgerEvent(db, cmdStart);

      const result = await runnerBridge.sendExec({ project_id: input.run.project_id, cmd: command });
      results.push({ gate, exit_code: result.exit_code, stdout: result.stdout, stderr: result.stderr });

      const stderr = result.stderr ?? "";
      if (
        result.exit_code !== 0 &&
        (stderr.includes("Denied by permissions") || stderr.includes("User denied command"))
      ) {
        const reason = stderr.includes("User denied") ? "ask_denied" : "deny";
        await appendLedgerEvent(
          db,
          createLedgerEvent({
            org_id: input.auth.org_id,
            user_id: input.auth.user_id,
            project_id: input.run.project_id,
            run_id: input.run_id,
            plan_id: input.run.plan_id,
            task_id: input.run.current_task_id,
            event_type: "RUNNER_CMD_BLOCKED",
            payload: { command, gate, reason }
          })
        );
        events.emit(input.run_id, {
          type: "PERMISSION_DENIED",
          ts: new Date().toISOString(),
          data: {
            run_id: input.run_id,
            task_id: input.run.current_task_id,
            command,
            gate,
            reason
          }
        });
      }

      const cmdFinish = createLedgerEvent({
        org_id: input.auth.org_id,
        user_id: input.auth.user_id,
        project_id: input.run.project_id,
        run_id: input.run_id,
        plan_id: input.run.plan_id,
        event_type: "RUNNER_CMD_FINISHED",
        payload: { command, exit_code: result.exit_code }
      });
      await appendLedgerEvent(db, cmdFinish);
    }

    const allPassed = results.every((r) => r.exit_code === 0);
    const reportLines = [
      `# Verify Report (${verifyMode})`,
      "",
      input.target ? `Target: ${input.target}` : "",
      ...results.map((result) => `- ${result.gate}: ${result.exit_code === 0 ? "PASS" : "FAIL"}`)
    ];
    const report = reportLines.join("\n");
    const logicalReportPath = `artifacts/${input.run.project_id}/${input.run_id}/${input.run.current_task_id ?? "task"}/verify-report.md`;
    const reportArtifact = writeArtifact(input.run_id, "verify-report.md", report);

    const verifyFinish = createLedgerEvent({
      org_id: input.auth.org_id,
      user_id: input.auth.user_id,
      project_id: input.run.project_id,
      run_id: input.run_id,
      plan_id: input.run.plan_id,
      event_type: "VERIFY_FINISHED",
      payload: { status: allPassed ? "pass" : "fail", report_path: logicalReportPath }
    });
    await appendLedgerEvent(db, verifyFinish);

    events.emit(input.run_id, {
      type: "VERIFY_FINISHED",
      ts: new Date().toISOString(),
      data: {
        run_id: input.run_id,
        task_id: input.run.current_task_id,
        status: allPassed ? "pass" : "fail",
        verify_report: logicalReportPath
      }
    });

    const sessionStats = await computeSessionStats(input.run_id);
    if (sessionStats) {
      events.emit(input.run_id, {
        type: "SESSION_STATS",
        ts: new Date().toISOString(),
        data: { run_id: input.run_id, ...sessionStats }
      });
    }

    return {
      status: allPassed ? "pass" : "fail",
      report_path: reportArtifact.path,
      gates: results
    };
  }

  app.post("/v1/runs/:run_id/verify", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    const body = (req.body ?? {}) as { mode?: "targeted" | "standard" | "strict"; target?: string };

    const run = (await db.query<Record<string, unknown>>("SELECT * FROM runs WHERE id = ?", [run_id]))[0] as
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

    const result = await executeVerify({ auth, run_id, run, mode: body.mode, target: body.target });
    reply.send(result);
  });

  app.post("/v1/runs/:run_id/apply", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const run_id = (req.params as { run_id: string }).run_id;
    const body = (req.body ?? {}) as {
      title?: string;
      body?: string;
      draft?: boolean;
      labels?: string[];
      reviewers?: string[];
      assignees?: string[];
      branch?: string;
      commit_message?: string;
    };

    const run = (await db.query<Record<string, unknown>>("SELECT * FROM runs WHERE id = ?", [run_id]))[0] as
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

    const taskRow = (await db.query<Record<string, unknown>>(
      "SELECT title, patch_text FROM tasks WHERE run_id = ? AND plan_task_id = ?",
      [run_id, run.current_task_id]
    ))[0] as { title?: string; patch_text?: string } | undefined;

    const patchText = taskRow?.patch_text;
    if (!patchText) {
      reply.code(400).send({ error: "no patch available" });
      return;
    }

    const verifyResult = await executeVerify({
      auth,
      run_id,
      run,
      mode: "strict"
    });
    if (verifyResult.status !== "pass") {
      reply.code(409).send({ error: "verify_failed", report_path: verifyResult.report_path });
      return;
    }

    const remoteResult = await runnerBridge.sendExec({
      project_id: run.project_id,
      cmd: "git config --get remote.origin.url",
      cwd: repoRoot
    });
    if (remoteResult.exit_code !== 0 || !remoteResult.stdout) {
      reply.code(500).send({ error: "remote_origin_missing" });
      return;
    }
    const repoInfo = parseGitHubRemote(remoteResult.stdout.trim());
    if (!repoInfo) {
      reply.code(400).send({ error: "unsupported_remote" });
      return;
    }

    const adapter = GitHubAdapter.fromEnv(repoInfo.owner, repoInfo.repo);
    const baseBranch = await adapter.getDefaultBranch();
    const branchName = body.branch ?? `trcoder/${run_id}/${run.current_task_id}`;

    const localBranchCheck = await runnerBridge.sendExec({
      project_id: run.project_id,
      cmd: `git show-ref --verify --quiet refs/heads/${branchName}`,
      cwd: repoRoot
    });
    if (localBranchCheck.exit_code === 0) {
      reply.code(409).send({ error: "branch_exists" });
      return;
    }

    let remoteBranchExists = false;
    try {
      remoteBranchExists = await adapter.branchExists(branchName);
    } catch (err) {
      reply.code(502).send({ error: "branch_check_failed", details: (err as Error).message });
      return;
    }
    if (remoteBranchExists) {
      reply.code(409).send({ error: "branch_exists_remote" });
      return;
    }

    const headResult = await runnerBridge.sendExec({
      project_id: run.project_id,
      cmd: "git rev-parse HEAD",
      cwd: repoRoot
    });
    if (headResult.exit_code !== 0 || !headResult.stdout) {
      reply.code(500).send({ error: "git_head_failed", details: headResult.stderr });
      return;
    }
    const headSha = headResult.stdout.trim();

    const patchPath = path.join(repoRoot, ".trcoder", "patches", `apply_${run_id}_${run.current_task_id}.diff`);
    const worktreePath = path.join(repoRoot, ".trcoder", "worktrees", `${run_id}_${run.current_task_id}`);
    const writeResult = await runnerBridge.sendWrite({
      project_id: run.project_id,
      path: patchPath,
      content: Buffer.from(patchText, "utf8").toString("base64"),
      encoding: "base64"
    });
    if (writeResult.exit_code !== 0) {
      reply.code(500).send({ error: "patch_write_failed" });
      return;
    }

    let worktreeCreated = false;
    let pushed = false;
    try {
      const worktreeResult = await runnerBridge.sendExec({
        project_id: run.project_id,
        cmd: `git worktree add -b ${branchName} \"${worktreePath}\" ${headSha}`,
        cwd: repoRoot
      });
      if (worktreeResult.exit_code !== 0) {
        reply.code(500).send({ error: "git_worktree_failed", details: worktreeResult.stderr });
        return;
      }
      worktreeCreated = true;

      const applyResult = await runnerBridge.sendExec({
        project_id: run.project_id,
        cmd: `git apply --index \"${patchPath}\"`,
        cwd: worktreePath
      });
      if (applyResult.exit_code !== 0) {
        reply.code(500).send({ error: "git_apply_failed", details: applyResult.stderr });
        return;
      }

      const commitMessage = body.commit_message ?? `TRCODER: apply ${run.current_task_id}`;
      const commitResult = await runnerBridge.sendExec({
        project_id: run.project_id,
        cmd: `git commit -m \"${commitMessage}\"`,
        cwd: worktreePath
      });
      if (commitResult.exit_code !== 0) {
        reply.code(500).send({ error: "git_commit_failed", details: commitResult.stderr });
        return;
      }

      const pushResult = await runnerBridge.sendExec({
        project_id: run.project_id,
        cmd: `git push -u origin ${branchName}`,
        cwd: worktreePath
      });
      if (pushResult.exit_code !== 0) {
        reply.code(500).send({ error: "git_push_failed", details: pushResult.stderr });
        return;
      }
      pushed = true;
    } finally {
      if (worktreeCreated) {
        await runnerBridge.sendExec({
          project_id: run.project_id,
          cmd: `git worktree remove --force \"${worktreePath}\"`,
          cwd: repoRoot
        });
      }
      if (worktreeCreated && !pushed) {
        await runnerBridge.sendExec({
          project_id: run.project_id,
          cmd: `git branch -D ${branchName}`,
          cwd: repoRoot
        });
      }
    }

    const prTitle = body.title ?? `TRCODER: ${taskRow?.title ?? run.current_task_id}`;
    const prBody =
      body.body ??
      `Automated by TRCODER\n\nRun: ${run_id}\nTask: ${run.current_task_id}\nBranch: ${branchName}\n`;

    let pr: { number: number; htmlUrl: string };
    try {
      pr = await adapter.createPullRequest({
        title: prTitle,
        body: prBody,
        sourceBranch: branchName,
        targetBranch: baseBranch,
        labels: body.labels,
        reviewers: body.reviewers,
        assignees: body.assignees,
        draft: body.draft ?? false
      });
    } catch (err) {
      reply.code(502).send({
        error: "pr_create_failed",
        details: (err as Error).message,
        branch: branchName,
        base_branch: baseBranch
      });
      return;
    }

    reply.send({
      ok: true,
      branch: branchName,
      base_branch: baseBranch,
      pr_number: pr.number,
      pr_url: pr.htmlUrl
    });
  });

  app.get("/v1/usage/month", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const usage = await computeUsageForMonth({ db, pricing, plan_id: auth.plan_id });
    reply.send(usage);
  });

  app.get("/v1/usage/today", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const usage = await computeUsageForRange({ db, pricing, plan_id: auth.plan_id, start, end });
    reply.send({ ...usage, range: { start: start.toISOString(), end: end.toISOString() } });
  });

  app.get("/v1/invoice/preview", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const invoice = await computeInvoicePreview({ db, pricing, plan_id: auth.plan_id });
    reply.send(invoice);
  });

  app.get("/v1/cost/explain", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const query = req.query as { task_id?: string; run_id?: string };
    if (!query.task_id && !query.run_id) {
      reply.code(400).send({ error: "task_id or run_id required" });
      return;
    }

    let row: { router_decision_json?: unknown } | undefined;
    if (query.task_id) {
      row = (await db.query<{ router_decision_json?: unknown }>(
        "SELECT router_decision_json FROM tasks WHERE plan_task_id = ?",
        [query.task_id]
      ))[0];
    } else if (query.run_id) {
      row = (await db.query<{ router_decision_json?: unknown }>(
        "SELECT router_decision_json FROM tasks WHERE run_id = ?",
        [query.run_id]
      ))[0];
    }

    if (!row?.router_decision_json) {
      reply.code(404).send({ error: "router decision not found" });
      return;
    }

    reply.send({
      router_decision: parseJsonValue<Record<string, unknown>>(row.router_decision_json, {})
    });
  });

  app.get("/v1/projects/:id/plan/tasks", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const planRow = (await db.query<{ tasks_json: unknown }>(
      "SELECT tasks_json FROM plans WHERE project_id = ? AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1",
      [project_id]
    ))[0];
    if (!planRow) {
      reply.code(404).send({ error: "no approved plan" });
      return;
    }
    const tasks = parseJsonValue<Record<string, unknown>>(planRow.tasks_json, {});
    reply.send(tasks);
  });

  app.get("/v1/logs/tail", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const query = req.query as { run_id?: string; limit?: string };
    if (!query.run_id) {
      reply.code(400).send({ error: "run_id required" });
      return;
    }
    const limit = clampInt(Number(query.limit ?? 50), 1, 500);
    const rows = await db.query<{ event_id: string; ts: string; event_type: string; payload_json?: unknown }>(
      "SELECT event_id, ts, event_type, payload_json FROM ledger_events WHERE run_id = ? ORDER BY ts DESC LIMIT ?",
      [query.run_id, limit]
    );
    reply.send({
      run_id: query.run_id,
      events: rows.map((row) => ({
        event_id: row.event_id,
        ts: row.ts,
        event_type: row.event_type,
        payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {})
      }))
    });
  });

  app.get("/v1/ledger/export", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const rows = await db.query<{
      event_id: string;
      ts: string;
      org_id: string;
      user_id: string;
      project_id: string;
      run_id?: string;
      plan_id?: string;
      task_id?: string;
      event_type: string;
      payload_json?: unknown;
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
          payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {})
        })
      )
      .join("\n");
    reply.send(jsonl);
  });

  app.post("/v1/projects/:id/init", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const project_id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { portable?: boolean; refresh?: boolean };
    const projectRow = (await db.query<{ repo_name?: string }>(
      "SELECT repo_name FROM projects WHERE id = ?",
      [project_id]
    ))[0];
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;

    const body = req.body as { budgets?: ContextPackManifest["budgets"]; pins?: string[] };
    const sanitizedPins = sanitizePins((body.pins ?? pack.pinned_sources).filter(Boolean));
    let newPack = buildContextPack({
      runId: pack.run_id,
      taskId: pack.task_id,
      budgets: body.budgets ?? pack.budgets,
      pins: sanitizedPins.pins
    });
    newPack = await enrichContextPack(newPack, record.project_id);
    await saveContextPack(db, { project_id: record.project_id, manifest: newPack });

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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
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
      await updateContextPack(db, pack);
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
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
      await updateContextPack(db, pack);
    }
    reply.send({ matches });
  });

  app.post("/v1/packs/:pack_id/diff", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
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
      await updateContextPack(db, pack);
    }
    const maxChars = clampInt(Number(body.max_chars ?? MAX_CTX_CHARS), 200, 20000);
    reply.send({ diff: limitText(redacted.text, maxChars) });
  });

  app.post("/v1/packs/:pack_id/gitlog", async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
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
      await updateContextPack(db, pack);
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
    if (!record) {
      reply.code(404).send({ error: "pack not found" });
      return;
    }
    const pack = record.manifest;

    const row = (await db.query<{ payload_json?: unknown }>(
      "SELECT payload_json FROM ledger_events WHERE run_id = ? AND event_type = ? ORDER BY ts DESC LIMIT 1",
      [pack.run_id, "VERIFY_FINISHED"]
    ))[0];

    if (!row?.payload_json) {
      reply.send({ status: "unknown", summary: "" });
      return;
    }

    const payload = parseJsonValue<{ status?: string; report_path?: string }>(row.payload_json, {});
    const reportPath = path.join(getArtifactsDir(), `run-${pack.run_id}`, "verify-report.md");
    let summary = "";
    if (fs.existsSync(reportPath)) {
      const content = fs.readFileSync(reportPath, "utf8");
      const redacted = redactText(content);
      if (redacted.masked_count > 0) {
        pack.redaction_stats.masked_entries += redacted.masked_count;
        pack.redaction_stats.masked_chars += redacted.masked_chars;
        await updateContextPack(db, pack);
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const pack_id = (req.params as { pack_id: string }).pack_id;
    const record = await getContextPackRecord(db, pack_id);
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
      await updateContextPack(db, pack);
    }
    const lines = tailLines(redacted.text, tail).map((line) => trimSnippet(line, 500));
    reply.send({ source, tail, lines });
  });

  return { app, db };
}
