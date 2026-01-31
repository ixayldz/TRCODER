import readline from "readline";
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { classifyCommand, PermissionsConfig, loadRiskPolicy } from "@trcoder/shared";
import { ApiClient } from "./api-client";
import { CliConfig, loadConfig, saveConfig } from "./config-store";
import { streamRunEvents } from "./sse-client";
import {
  formatAnomaly,
  formatRunBanner,
  formatSessionStats,
  formatStage,
  formatTaskHeader,
  formatTaskResult
} from "./output";
import { loadPermissionPolicy } from "./permissions";
import { RunnerClient } from "./runner-client";
import { parseSlashCommand } from "./parser";

export class Shell {
  private rl: readline.Interface;
  private config: CliConfig;
  private api: ApiClient;
  private runner: RunnerClient;
  private streamingRuns = new Set<string>();
  private permissions: PermissionsConfig;

  constructor() {
    this.config = loadConfig();
    this.api = new ApiClient(this.config);
    const permissions = loadPermissionPolicy();
    this.permissions = permissions;
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.runner = new RunnerClient({
      serverUrl: this.config.server_url,
      apiKey: this.config.api_key,
      projectId: this.config.project_id ?? "",
      permissions,
      confirm: (question) => this.promptYesNo(question),
      log: (message) => console.log(message)
    });
  }

  async start(): Promise<void> {
    if (!this.config.project_id) {
      console.log("No project connected. Run: trcoder connect");
      this.rl.close();
      return;
    }

    this.runner.connect();
    this.printPrompt();

    this.rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.printPrompt();
        return;
      }
      try {
        await this.handleCommand(trimmed);
      } catch (err) {
        console.log(`Error: ${(err as Error).message}`);
      }
      this.printPrompt();
    });
  }

  private printPrompt(): void {
    const project = this.config.project_id ?? "unknown";
    this.rl.setPrompt(`trcoder[${project}]> `);
    this.rl.prompt();
  }

  private async promptYesNo(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl.question(`${question} (y/N): `, (answer) => {
        resolve(answer.trim().toLowerCase() === "y");
      });
    });
  }

  private async promptExact(question: string, expected: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl.question(`${question} `, (answer) => {
        resolve(answer.trim() === expected);
      });
    });
  }

  private async handleCommand(input: string): Promise<void> {
    const parsed = parseSlashCommand(input);
    if (!parsed) {
      console.log("Commands must start with /");
      return;
    }

    const command = parsed.command;
    const tokens = parsed.args;

    switch (command) {
      case "help":
        this.printHelp(tokens[0]);
        break;
      case "whoami":
        await this.cmdWhoami();
        break;
      case "plan":
        await this.cmdPlan(tokens);
        break;
      case "start":
        await this.cmdStart(tokens);
        break;
      case "run":
        await this.cmdRun(tokens);
        break;
      case "tasks":
        await this.cmdTasks();
        break;
      case "attach":
        await this.cmdAttach(tokens[0]);
        break;
      case "context":
        await this.cmdContext(tokens);
        break;
      case "pins":
        this.cmdPins(tokens);
        break;
      case "verify":
        await this.cmdVerify(tokens);
        break;
      case "fix":
        await this.cmdFix();
        break;
      case "diff":
        this.cmdDiff();
        break;
      case "apply":
        await this.cmdApply();
        break;
      case "usage":
        await this.cmdUsage(tokens);
        break;
      case "export":
        await this.cmdExport(tokens);
        break;
      case "invoice":
        await this.cmdInvoice(tokens);
        break;
      case "cost":
        await this.cmdCost(tokens);
        break;
      case "lane":
        this.cmdLane(tokens);
        break;
      case "risk":
        this.cmdRisk(tokens);
        break;
      case "budget":
        this.cmdBudget(tokens);
        break;
      case "permissions":
        this.cmdPermissions(tokens);
        break;
      case "doctor":
        this.cmdDoctor();
        break;
      case "logs":
        await this.cmdLogs(tokens);
        break;
      case "project":
        await this.cmdProject(tokens);
        break;
      case "pr":
        this.cmdPr(tokens);
        break;
      case "init":
        await this.cmdInit(tokens);
        break;
      case "next":
        await this.cmdNext();
        break;
      default:
        console.log(`Unknown command: ${command}`);
    }
  }

  private printHelp(command?: string): void {
    const helpMap: Record<string, string> = {
      help: "/help [command]",
      whoami: "/whoami",
      plan: "/plan [from @file] | /plan status | /plan diff | /plan approve",
      start: "/start [--task <task_id>]",
      run: "/run status | /run pause | /run resume | /run cancel",
      tasks: "/tasks",
      attach: "/attach <run_id>",
      context: "/context show | /context expand|trim [--max-lines N --max-files N --depth N --topk N]",
      pins: "/pins add @<file> | /pins rm @<file> | /pins list",
      verify: "/verify [--target <path>]",
      fix: "/fix",
      diff: "/diff",
      apply: "/apply",
      usage: "/usage month | /usage today",
      invoice: "/invoice preview",
      cost: "/cost explain <task_id>",
      lane: "/lane set speed|balanced|quality|cost-saver",
      risk: "/risk set low|standard|high",
      budget: "/budget cap <usd> | /budget status",
      permissions: "/permissions [allow|ask|deny] \"<cmd>\"",
      doctor: "/doctor",
      logs: "/logs tail [--run <id>]",
      project: "/project status",
      pr: "/pr status",
      init: "/init [--portable] [--refresh]",
      next: "/next"
    };
    if (command) {
      const text = helpMap[command];
      console.log(text ?? `Unknown command: ${command}`);
      return;
    }
    console.log(
      [
        "/help",
        "/whoami",
        "/plan [from @file]",
        "/plan status",
        "/plan diff",
        "/plan approve",
        "/start",
        "/start --task <task_id>",
        "/next",
        "/run status",
        "/run pause|resume|cancel",
        "/tasks",
        "/attach <run_id>",
        "/context show",
        "/context expand|trim",
        "/context rebuild",
        "/pins add|rm|list",
        "/verify",
        "/verify --target <path>",
        "/fix",
        "/diff",
        "/apply",
        "/usage month",
        "/usage today",
        "/invoice preview",
        "/cost explain <task_id>",
        "/lane set <speed|balanced|quality|cost-saver>",
        "/risk set <low|standard|high>",
        "/budget cap <usd>",
        "/budget status",
        "/permissions",
        "/doctor",
        "/logs tail",
        "/export ledger",
        "/project status",
        "/pr status",
        "/init"
      ].join("\n")
    );
  }

  private async cmdWhoami(): Promise<void> {
    const data = await this.api.get<any>("/v1/whoami");
    console.log(`Org: ${data.org_id} | User: ${data.user_id}`);
    console.log(`Plan: ${data.plan_id} | Credits Used: ${data.credits_used}/${data.credits_included}`);
    console.log(`PAYG Overage: $${data.payg_overage}`);
  }

  private async cmdPlan(args: string[]): Promise<void> {
    if (args[0] === "status") {
      const status = await this.api.get<any>(`/v1/projects/${this.config.project_id}/plan/status`);
      const localCommit = await this.getRepoCommit();
      const approvedCommit = status.approved_repo_commit;
      const stale = approvedCommit && approvedCommit !== localCommit;
      console.log(
        JSON.stringify(
          {
            latest_plan_id: status.latest_plan_id,
            approved_plan_id: status.approved_plan_id,
            approved_repo_commit: approvedCommit,
            local_repo_commit: localCommit,
            stale
          },
          null,
          2
        )
      );
      return;
    }

    if (args[0] === "diff") {
      const status = await this.api.get<any>(`/v1/projects/${this.config.project_id}/plan/status`);
      if (status.latest_plan_id === status.approved_plan_id) {
        console.log("No plan diff: latest plan is approved.");
      } else {
        console.log(
          `Plan diff: latest=${status.latest_plan_id ?? "n/a"} approved=${status.approved_plan_id ?? "n/a"}`
        );
      }
      return;
    }

    if (args[0] === "approve") {
      const status = await this.api.get<any>(`/v1/projects/${this.config.project_id}/plan/status`);
      const planId = status.approved_plan_id ?? status.latest_plan_id ?? this.config.last_plan_id;
      if (!planId) {
        console.log("No plan to approve.");
        return;
      }
      const commit = await this.getRepoCommit();
      await this.api.post(`/v1/projects/${this.config.project_id}/plan/approve`, {
        plan_id: planId,
        repo_commit: commit
      });
      console.log(`Plan approved: ${planId}`);
      return;
    }

    let input: { text?: string; files?: Array<{ path: string; content: string }> } | undefined;
    let pins: string[] = [...(this.config.pins ?? [])];
    if (args[0] === "from" && args[1]?.startsWith("@")) {
      const filePath = args[1].slice(1);
      const content = fs.readFileSync(filePath, "utf8");
      input = { files: [{ path: filePath, content }] };
      if (!pins.includes(filePath)) {
        pins.push(filePath);
      }
    }

    const res = await this.api.post<any>(`/v1/projects/${this.config.project_id}/plan`, {
      input,
      pins
    });
    this.config.last_plan_id = res.plan_id;
    saveConfig(this.config);
    console.log(`Plan created: ${res.plan_id}`);
  }

  private async cmdStart(args: string[]): Promise<void> {
    const status = await this.api.get<any>(`/v1/projects/${this.config.project_id}/plan/status`);
    const localCommit = await this.getRepoCommit();
    if (status.approved_repo_commit && status.approved_repo_commit !== localCommit) {
      console.log(`Plan stale. Approved commit: ${status.approved_repo_commit}, local: ${localCommit}`);
      const confirm = await this.promptExact("TYPE: START to override", "START");
      if (!confirm) {
        console.log("Start cancelled.");
        return;
      }
    }

    const taskIndex = args.findIndex((arg) => arg === "--task");
    const taskId = taskIndex !== -1 ? args[taskIndex + 1] : undefined;

    const riskPolicy = this.loadRiskPolicySafe();
    const taskMeta = await this.getTaskMeta(taskId);
    let requiresConfirm = false;
    const reasons: string[] = [];
    const riskLevel = this.config.risk ?? "standard";
    if (riskPolicy?.risk_levels?.[riskLevel]?.requires_confirmation) {
      requiresConfirm = true;
      reasons.push(`risk level ${riskLevel}`);
    }
    if (taskMeta?.risk === "high") {
      requiresConfirm = true;
      reasons.push("task risk high");
    }
    if (taskMeta?.type && riskPolicy?.high_risk_task_types?.includes(taskMeta.type)) {
      requiresConfirm = true;
      reasons.push("high risk task type");
    }
    if (taskMeta?.scope?.paths && riskPolicy?.high_risk_path_patterns?.length) {
      const matched = taskMeta.scope.paths.some((p) =>
        riskPolicy.high_risk_path_patterns.some((pattern) => this.globMatch(pattern, p))
      );
      if (matched) {
        requiresConfirm = true;
        reasons.push("high risk path");
      }
    }

    let confirmHighRisk = false;
    if (requiresConfirm) {
      console.log(`High risk confirmation required (${reasons.join(", ") || "policy"}).`);
      const confirm = await this.promptExact("TYPE: RISK HIGH to proceed", "RISK HIGH");
      if (!confirm) {
        console.log("Start cancelled.");
        return;
      }
      confirmHighRisk = true;
    }

    const res = await this.api.post<any>(`/v1/projects/${this.config.project_id}/runs/start`, {
      lane: this.config.lane,
      risk: this.config.risk,
      budget_cap_usd: this.config.budget_cap_usd,
      context_budget: this.config.context_override,
      task_id: taskId,
      confirm_high_risk: confirmHighRisk
    });
    const runId = res.run_id as string;
    this.config.last_run_id = runId;
    saveConfig(this.config);

    if (!this.streamingRuns.has(runId)) {
      this.streamingRuns.add(runId);
      streamRunEvents(this.config, runId, (event) => this.handleRunEvent(event)).catch((err) => {
        console.log(`stream error: ${err.message}`);
      });
    }
    console.log(`Run started: ${runId}`);
  }

  private loadRiskPolicySafe(): ReturnType<typeof loadRiskPolicy> | null {
    try {
      const repoRoot = this.findRepoRoot();
      return loadRiskPolicy(path.join(repoRoot, "config", "risk-policy.v1.yaml"));
    } catch {
      return null;
    }
  }

  private globMatch(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
    return regex.test(value);
  }

  private findRepoRoot(): string {
    let current = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      const candidate = path.join(current, "config", "risk-policy.v1.yaml");
      if (fs.existsSync(candidate)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return process.cwd();
  }

  private async getTaskMeta(taskId?: string): Promise<any | null> {
    try {
      const tasks = await this.api.get<any>(`/v1/projects/${this.config.project_id}/plan/tasks`);
      const allTasks = tasks.phases?.flatMap((phase: any) => phase.tasks) ?? [];
      if (taskId) {
        return allTasks.find((task: any) => task.id === taskId) ?? null;
      }
      return allTasks[0] ?? null;
    } catch {
      return null;
    }
  }

  private handleRunEvent(event: { type: string; ts: string; data: any }): void {
    if (event.type === "RUN_BANNER") {
      console.log(formatRunBanner(event.data));
      if (typeof event.data?.fix_loop_max_iters === "number") {
        this.config.fix_loop_max_iters = event.data.fix_loop_max_iters;
        saveConfig(this.config);
      }
    } else if (event.type === "TASK_STARTED") {
      console.log(formatTaskHeader(event.data));
      this.config.last_context_pack = {
        pack_id: event.data.context_pack?.id,
        task_id: event.data.task_id,
        run_id: this.config.last_run_id ?? "",
        mode: event.data.context_pack?.mode ?? "manifest",
        pinned_sources: this.config.pins ?? [],
        file_entries: [],
        signals: {},
        budgets: event.data.context_pack?.budgets,
        redaction_stats: { masked_entries: 0, masked_chars: 0 }
      } as any;
      this.config.last_task_id = event.data.task_id;
      saveConfig(this.config);
    } else if (event.type === "TASK_STAGE") {
      console.log(formatStage(event.data));
    } else if (event.type === "TASK_RESULT") {
      console.log(formatTaskResult(event.data));
      if (event.data.patch_text || event.data.patch_path) {
        this.config.last_patch = {
          path: event.data.patch_path,
          text: event.data.patch_text,
          summary: event.data.patch_path
        };
        saveConfig(this.config);
      }
    } else if (event.type === "VERIFY_FINISHED") {
      console.log(`Verify: ${event.data.status} (${event.data.verify_report ?? "no report"})`);
    } else if (event.type === "ANOMALY") {
      console.log(formatAnomaly(event.data));
    } else if (event.type === "SESSION_STATS") {
      console.log(formatSessionStats(event.data));
    }
  }

  private async cmdRun(args: string[]): Promise<void> {
    const action = args[0];
    if (!action || action === "status") {
      if (!this.config.last_run_id) {
        console.log("No active run.");
        return;
      }
      const status = await this.api.get<any>(`/v1/runs/${this.config.last_run_id}/status`);
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    if (!this.config.last_run_id) {
      console.log("No active run.");
      return;
    }
    if (action === "pause" || action === "resume" || action === "cancel") {
      await this.api.post(`/v1/runs/${this.config.last_run_id}/${action}`);
      console.log(`Run ${action}d.`);
      return;
    }
    console.log("Usage: /run status|pause|resume|cancel");
  }

  private async cmdTasks(): Promise<void> {
    const runs = await this.api.get<any>(`/v1/projects/${this.config.project_id}/runs`);
    console.log(JSON.stringify(runs, null, 2));
  }

  private async cmdAttach(runId?: string): Promise<void> {
    const target = runId ?? this.config.last_run_id;
    if (!target) {
      console.log("Usage: /attach <run_id>");
      return;
    }
    if (!this.streamingRuns.has(target)) {
      this.streamingRuns.add(target);
      streamRunEvents(this.config, target, (event) => this.handleRunEvent(event)).catch((err) => {
        console.log(`stream error: ${err.message}`);
      });
    }
    this.config.last_run_id = target;
    saveConfig(this.config);
    console.log(`Attached to run: ${target}`);
  }

  private async cmdContext(args: string[]): Promise<void> {
    if (args[0] === "show") {
      if (!this.config.last_context_pack?.pack_id) {
        console.log("No context pack available.");
        return;
      }
      try {
        const stats = await this.api.get<any>(
          `/v1/packs/${this.config.last_context_pack.pack_id}/stats`
        );
        console.log(JSON.stringify(stats, null, 2));
      } catch {
        console.log(JSON.stringify(this.config.last_context_pack, null, 2));
      }
      return;
    }

    if (args[0] === "expand" || args[0] === "trim") {
      if (!this.config.last_context_pack?.pack_id) {
        console.log("No context pack available.");
        return;
      }
      const base =
        this.config.context_override ??
        this.config.last_context_pack?.budgets ?? {
          max_files: 40,
          max_lines: 1800,
          graph_depth: 2,
          top_k: 16,
          hydrate: false
        };

      const getNumberFlag = (flag: string): number | undefined => {
        const idx = args.indexOf(flag);
        if (idx !== -1 && args[idx + 1]) {
          const value = Number(args[idx + 1]);
          if (!Number.isNaN(value)) return value;
        }
        return undefined;
      };

      const hasExplicit =
        args.includes("--max-lines") ||
        args.includes("--max-files") ||
        args.includes("--depth") ||
        args.includes("--topk");

      const delta = args[0] === "expand" ? 1 : -1;
      const newBudget = {
        max_files: hasExplicit ? base.max_files : Math.max(5, base.max_files + delta * 10),
        max_lines: hasExplicit ? base.max_lines : Math.max(200, base.max_lines + delta * 400),
        graph_depth: hasExplicit ? base.graph_depth : Math.max(1, base.graph_depth + delta),
        top_k: hasExplicit ? base.top_k : Math.max(4, base.top_k + delta * 4),
        hydrate: base.hydrate
      };

      const maxLines = getNumberFlag("--max-lines");
      const maxFiles = getNumberFlag("--max-files");
      const depth = getNumberFlag("--depth");
      const topk = getNumberFlag("--topk");
      if (typeof maxLines === "number") newBudget.max_lines = Math.max(200, maxLines);
      if (typeof maxFiles === "number") newBudget.max_files = Math.max(5, maxFiles);
      if (typeof depth === "number") newBudget.graph_depth = Math.max(1, depth);
      if (typeof topk === "number") newBudget.top_k = Math.max(4, topk);
      if (args.includes("--hydrate")) newBudget.hydrate = true;

      const pins = new Set(this.config.last_context_pack?.pinned_sources ?? []);
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "--include" && args[i + 1]) {
          const value = args[i + 1];
          if (value === "docs") pins.add("docs/**");
          else if (value === "tests") pins.add("tests/**");
          else pins.add(value);
          i += 1;
        }
        if (args[i] === "--drop" && args[i + 1]) {
          const value = args[i + 1];
          const target = value === "docs" ? "docs/**" : value === "tests" ? "tests/**" : value;
          pins.delete(target);
          i += 1;
        }
        if (args[i] === "--keep" && args[i + 1]) {
          const value = args[i + 1];
          const pathValue = value.startsWith("paths=") ? value.slice("paths=".length) : value;
          for (const item of pathValue.split(",")) {
            if (item.trim()) pins.add(item.trim());
          }
          i += 1;
        }
      }

      const rebuild = await this.api.post<any>(
        `/v1/packs/${this.config.last_context_pack.pack_id}/rebuild`,
        { budgets: newBudget, pins: Array.from(pins) }
      );
      this.config.context_override = newBudget;
      this.config.last_context_pack = {
        ...this.config.last_context_pack,
        pack_id: rebuild.new_pack_id,
        budgets: newBudget,
        pinned_sources: Array.from(pins)
      } as any;
      saveConfig(this.config);
      console.log(`Context pack rebuilt: ${rebuild.new_pack_id}`);
      return;
    }

    if (args[0] === "rebuild") {
      if (!this.config.last_context_pack?.pack_id) {
        console.log("No context pack available.");
        return;
      }
      const rebuild = await this.api.post<any>(
        `/v1/packs/${this.config.last_context_pack.pack_id}/rebuild`,
        {
          budgets: this.config.last_context_pack.budgets,
          pins: this.config.last_context_pack.pinned_sources ?? []
        }
      );
      this.config.last_context_pack = {
        ...this.config.last_context_pack,
        pack_id: rebuild.new_pack_id
      } as any;
      saveConfig(this.config);
      console.log(`Context pack rebuilt: ${rebuild.new_pack_id}`);
      return;
    }

    console.log("Usage: /context show | /context expand | /context trim | /context rebuild");
  }

  private async cmdVerify(args: string[]): Promise<void> {
    if (!this.config.last_run_id) {
      console.log("No active run.");
      return;
    }
    const mode = args.includes("--strict") ? "strict" : undefined;
    const targetIdx = args.findIndex((arg) => arg === "--target");
    const target = targetIdx !== -1 ? args[targetIdx + 1] : undefined;
    const res = await this.api.post<any>(`/v1/runs/${this.config.last_run_id}/verify`, {
      mode,
      target
    });
    console.log(`Verify: ${res.status}`);
  }

  private async cmdFix(): Promise<void> {
    if (!this.config.last_run_id) {
      console.log("No active run.");
      return;
    }
    const maxIters = this.config.fix_loop_max_iters ?? 3;
    const taskId = this.config.last_task_id;
    for (let i = 0; i < maxIters; i += 1) {
      const verify = await this.api.post<any>(`/v1/runs/${this.config.last_run_id}/verify`, {});
      if (verify.status === "pass") {
        console.log("Fix loop complete.");
        return;
      }
      if (!taskId) {
        console.log("No task id available for fix loop.");
        return;
      }
      console.log(`Verify failed. Starting fix iteration ${i + 1}/${maxIters}...`);
      await this.cmdStart(["--task", taskId]);
    }
    console.log("Fix loop reached max iterations.");
  }

  private cmdDiff(): void {
    if (!this.config.last_patch?.text) {
      console.log("No patch available.");
      return;
    }
    const lines = this.config.last_patch.text.split(/\r?\n/).slice(0, 12);
    console.log(lines.join("\n"));
  }

  private async cmdApply(): Promise<void> {
    if (!this.config.last_run_id || !this.config.last_patch?.text) {
      console.log("No patch available to apply.");
      return;
    }

    const confirmed = await this.promptExact("TYPE: APPLY to confirm", "APPLY");
    if (!confirmed) {
      console.log("Apply cancelled.");
      return;
    }

    const verify = await this.api.post<any>(`/v1/runs/${this.config.last_run_id}/verify`, {
      mode: "strict"
    });
    if (verify.status !== "pass") {
      console.log("Strict verify failed. Aborting apply.");
      return;
    }

    const patchFile = path.join(os.tmpdir(), `trcoder_patch_${this.config.last_run_id}.diff`);
    fs.writeFileSync(patchFile, this.config.last_patch.text, "utf8");

    const taskId = this.config.last_task_id ?? "patch";
    const branchName = `trcoder/${this.config.last_run_id}/${taskId}`;
    const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trcoder-worktree-"));

    const worktreeCmd = `git worktree add -b ${branchName} \"${worktreeRoot}\"`;
    const worktreeOutcome = await this.runLocalCommandInteractive(worktreeCmd, process.cwd());
    if (!worktreeOutcome.ok) {
      console.log("Worktree add failed. Aborting apply.");
      console.log(worktreeOutcome.stderr || worktreeOutcome.stdout);
      return;
    }
    let worktreeCreated = true;

    const applyCmd = `git -C \"${worktreeRoot}\" apply --index \"${patchFile}\"`;
    const commitCmd = `git -C \"${worktreeRoot}\" commit -m \"TRCODER: apply ${taskId}\"`;
    const pushCmd = `git -C \"${worktreeRoot}\" push -u origin ${branchName}`;

    try {
      const commands = [applyCmd, commitCmd, pushCmd];
      for (const cmd of commands) {
        const outcome = await this.runLocalCommandInteractive(cmd, worktreeRoot);
        if (!outcome.ok) {
          console.log(`Command failed: ${cmd}`);
          console.log(outcome.stderr || outcome.stdout);
          return;
        }
      }
      console.log(`Apply complete on branch ${branchName} (PR adapter stub).`);
    } finally {
      if (worktreeCreated) {
        await this.runLocalCommandInteractive(`git worktree remove \"${worktreeRoot}\"`, process.cwd());
      }
    }
  }

  private async cmdUsage(args: string[]): Promise<void> {
    if (args[0] === "today") {
      const usage = await this.api.get<any>("/v1/usage/today");
      console.log(JSON.stringify(usage, null, 2));
      return;
    }
    if (args[0] !== "month") {
      console.log("Usage: /usage month|today");
      return;
    }
    const usage = await this.api.get<any>("/v1/usage/month");
    console.log(JSON.stringify(usage, null, 2));
  }

  private async cmdExport(args: string[]): Promise<void> {
    if (args[0] !== "ledger") {
      console.log("Usage: /export ledger");
      return;
    }
    const exportData = await this.api.get<any>("/v1/ledger/export");
    console.log(exportData);
  }

  private async cmdInvoice(args: string[]): Promise<void> {
    if (args[0] !== "preview") {
      console.log("Usage: /invoice preview");
      return;
    }
    const invoice = await this.api.get<any>("/v1/invoice/preview");
    console.log(JSON.stringify(invoice, null, 2));
  }

  private async cmdCost(args: string[]): Promise<void> {
    if (args[0] !== "explain") {
      console.log("Usage: /cost explain <task_id>");
      return;
    }
    const taskId = args[1] ?? this.config.last_task_id;
    if (!taskId) {
      console.log("No task id available.");
      return;
    }
    const res = await this.api.get<any>(`/v1/cost/explain?task_id=${taskId}`);
    console.log(JSON.stringify(res, null, 2));
  }

  private cmdLane(args: string[]): void {
    if (args[0] !== "set" || !args[1]) {
      console.log("Usage: /lane set speed|balanced|quality|cost-saver");
      return;
    }
    this.config.lane = args[1] as any;
    saveConfig(this.config);
    console.log(`Lane set to ${this.config.lane}`);
  }

  private cmdRisk(args: string[]): void {
    if (args[0] !== "set" || !args[1]) {
      console.log("Usage: /risk set low|standard|high");
      return;
    }
    this.config.risk = args[1] as any;
    saveConfig(this.config);
    console.log(`Risk set to ${this.config.risk}`);
  }

  private cmdBudget(args: string[]): void {
    if (args[0] !== "cap" || !args[1]) {
      if (args[0] === "status") {
        console.log(`Budget cap: ${this.config.budget_cap_usd ?? "not set"}`);
        return;
      }
      console.log("Usage: /budget cap <usd> | /budget status");
      return;
    }
    const value = Number(args[1]);
    if (Number.isNaN(value)) {
      console.log("Budget cap must be a number.");
      return;
    }
    this.config.budget_cap_usd = value;
    saveConfig(this.config);
    console.log(`Budget cap set to $${value}`);
  }

  private cmdPermissions(args: string[]): void {
    const filePath = path.join(os.homedir(), ".trcoder", "permissions.json");
    if (!args[0]) {
      const effective = loadPermissionPolicy();
      const override = fs.existsSync(filePath)
        ? (JSON.parse(fs.readFileSync(filePath, "utf8")) as any)
        : { allow: [], ask: [], deny: [] };
      console.log(JSON.stringify({ effective, override }, null, 2));
      return;
    }
    const action = args[0];
    const cmd = args.slice(1).join(" ");
    const override = fs.existsSync(filePath)
      ? (JSON.parse(fs.readFileSync(filePath, "utf8")) as any)
      : { allow: [], ask: [], deny: [] };
    if ((action === "allow" || action === "deny" || action === "ask") && cmd) {
      override[action] = Array.from(new Set([...(override[action] ?? []), cmd]));
      fs.writeFileSync(filePath, JSON.stringify(override, null, 2));
      console.log(`Permissions updated: ${action} ${cmd}`);
      return;
    }
    console.log("Usage: /permissions [allow|ask|deny] \"<cmd>\"");
  }

  private cmdPins(args: string[]): void {
    const action = args[0];
    const target = args[1];
    this.config.pins = this.config.pins ?? [];
    if (!action || action === "list") {
      console.log(JSON.stringify(this.config.pins, null, 2));
      return;
    }
    if (action === "add" && target?.startsWith("@")) {
      const pathValue = target.slice(1);
      if (!this.config.pins.includes(pathValue)) {
        this.config.pins.push(pathValue);
        saveConfig(this.config);
      }
      console.log(`Pinned: ${pathValue}`);
      return;
    }
    if (action === "rm" && target?.startsWith("@")) {
      const pathValue = target.slice(1);
      this.config.pins = this.config.pins.filter((pin) => pin !== pathValue);
      saveConfig(this.config);
      console.log(`Unpinned: ${pathValue}`);
      return;
    }
    console.log("Usage: /pins add @<file> | /pins rm @<file> | /pins list");
  }

  private cmdDoctor(): void {
    console.log(`storage.method: ${this.config.storage?.method ?? "file"}`);
    console.log(`storage.encrypted: ${this.config.storage?.encrypted ?? false}`);
    const filePath = path.join(os.homedir(), ".trcoder", "cli.json");
    if (fs.existsSync(filePath)) {
      console.log(`config.path: ${filePath}`);
      if (process.platform !== "win32") {
        try {
          const stat = fs.statSync(filePath);
          const mode = stat.mode & 0o777;
          const status = mode <= 0o600 ? "OK" : "WARN";
          console.log(`file.permissions: ${status} (${mode.toString(8)})`);
        } catch {
          console.log("file.permissions: WARN");
        }
      } else {
        console.log("file.permissions: N/A (windows)");
      }
    }
  }

  private async cmdLogs(args: string[]): Promise<void> {
    if (args[0] !== "tail") {
      console.log("Usage: /logs tail [--run <id>]");
      return;
    }
    const runIdx = args.findIndex((arg) => arg === "--run");
    const runId = runIdx !== -1 ? args[runIdx + 1] : this.config.last_run_id;
    const logs = await this.api.get<any>(`/v1/logs/tail?run_id=${runId ?? ""}`);
    console.log(JSON.stringify(logs, null, 2));
  }

  private async cmdProject(args: string[]): Promise<void> {
    if (args[0] !== "status") {
      console.log("Usage: /project status");
      return;
    }
    const status = await this.api.get<any>(`/v1/projects/${this.config.project_id}/plan/status`);
    console.log(JSON.stringify(status, null, 2));
  }

  private cmdPr(args: string[]): void {
    if (args[0] !== "status") {
      console.log("Usage: /pr status");
      return;
    }
    console.log("PR adapter not implemented in V1.");
  }

  private async cmdInit(args: string[]): Promise<void> {
    const res = await this.api.post<any>(`/v1/projects/${this.config.project_id}/init`, {
      portable: args.includes("--portable"),
      refresh: args.includes("--refresh")
    });
    if (res.patch_text) {
      this.config.last_patch = {
        path: res.patch_path,
        text: res.patch_text,
        summary: res.patch_path
      };
      saveConfig(this.config);
    }
    console.log(`Init patch ready: ${res.patch_path ?? "n/a"}`);
  }

  private async cmdNext(): Promise<void> {
    const tasks = await this.api.get<any>(`/v1/projects/${this.config.project_id}/plan/tasks`);
    const allTasks = tasks.phases?.flatMap((phase: any) => phase.tasks) ?? [];
    const currentIdx = allTasks.findIndex((task: any) => task.id === this.config.last_task_id);
    const nextTask = allTasks[currentIdx + 1];
    if (!nextTask) {
      console.log("No next task available.");
      return;
    }
    await this.cmdStart(["--task", nextTask.id]);
  }

  private async getRepoCommit(): Promise<string> {
    try {
      const { execSync } = await import("child_process");
      const output = execSync("git log -1 --format=%H").toString().trim();
      return output || "DEV";
    } catch {
      return "DEV";
    }
  }

  private async runLocalCommandInteractive(
    cmd: string,
    cwd: string
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const permission = classifyCommand(cmd, this.permissions);
    if (permission === "deny") {
      return { ok: false, stdout: "", stderr: "Denied by permissions" };
    }
    if (permission === "ask") {
      const allowed = await this.promptYesNo(`Allow command? ${cmd}`);
      if (!allowed) {
        return { ok: false, stdout: "", stderr: "User denied command" };
      }
    }

    const result = spawnSync(cmd, {
      shell: true,
      cwd,
      windowsHide: true,
      encoding: "utf8"
    });

    return {
      ok: result.status === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
}
