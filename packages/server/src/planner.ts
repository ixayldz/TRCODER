import { Lane, RiskLevel, TasksFileV1, TaskDefinition, TaskScope } from "@trcoder/shared";
import { ChatCompletionResponse, IModelProvider } from "./providers/provider.interface";
import { redactText } from "./redaction";

type PlanInputFile = { path: string; content: string };

function clampString(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...<truncated>";
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function makeTaskId(n: number): string {
  return `task-${String(n).padStart(3, "0")}`;
}

function baseScope(): TaskScope {
  return {
    paths: ["**/*"],
    exclude_paths: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/artifacts/**"],
    symbols: [],
    queries: []
  };
}

function task(input: {
  id: string;
  title: string;
  type: string;
  risk: RiskLevel;
  deps: string[];
  scope?: Partial<TaskScope>;
  acceptance: string[];
}): TaskDefinition {
  return {
    id: input.id,
    title: input.title,
    type: input.type,
    risk: input.risk,
    deps: input.deps,
    scope: { ...baseScope(), ...(input.scope ?? {}) },
    acceptance: input.acceptance,
    execution: { lane: "balanced", budget_usd: { min: 0.2, max: 1.5 } },
    outputs: { patch: `artifacts/patch_${input.id}.diff`, docs: [] }
  };
}

function looksLikeTodoApp(request: string): boolean {
  const s = request.toLowerCase();
  return s.includes("todo") || s.includes("to-do") || s.includes("gorev") || s.includes("task list");
}

function wantsFrontend(request: string): boolean {
  const s = request.toLowerCase();
  return (
    looksLikeTodoApp(s) ||
    s.includes("ui") ||
    s.includes("frontend") ||
    s.includes("web") ||
    s.includes("react") ||
    s.includes("next") ||
    s.includes("vue") ||
    s.includes("svelte") ||
    s.includes("mobil") ||
    s.includes("mobile")
  );
}

function wantsDatabase(request: string): boolean {
  const s = request.toLowerCase();
  return (
    looksLikeTodoApp(s) ||
    s.includes("db") ||
    s.includes("database") ||
    s.includes("postgres") ||
    s.includes("sql") ||
    s.includes("sqlite") ||
    s.includes("prisma") ||
    s.includes("migration") ||
    s.includes("schema")
  );
}

function buildHeuristicTasks(input: {
  planId: string;
  projectName: string;
  requestText: string;
  lane: Lane;
  risk: RiskLevel;
}): TasksFileV1 {
  const titleSeed = normalizeWhitespace(input.requestText || "New feature");
  const shortTitle = clampString(titleSeed, 80);
  const reviewType = input.lane === "quality" ? "deep_review" : "quick_review";

  let i = 1;
  const t1 = makeTaskId(i++);
  const t2 = makeTaskId(i++);
  const t3 = makeTaskId(i++);
  const t4 = makeTaskId(i++);
  const t5 = makeTaskId(i++);
  const t6 = makeTaskId(i++);

  const tasks: TaskDefinition[] = [];

  tasks.push(
    task({
      id: t1,
      title: `Architecture + API outline: ${shortTitle}`,
      type: "architecture_design",
      risk: input.risk,
      deps: [],
      acceptance: ["Clear API surface + data model documented", "Key tradeoffs listed"]
    })
  );

  if (wantsDatabase(input.requestText)) {
    tasks.push(
      task({
        id: t2,
        title: `Database schema + persistence: ${shortTitle}`,
        type: "database_code",
        risk: input.risk,
        deps: [t1],
        acceptance: ["DB schema/migrations exist", "CRUD persistence layer implemented"]
      })
    );
  } else {
    tasks.push(
      task({
        id: t2,
        title: `Persistence layer (in-memory/file) + interfaces: ${shortTitle}`,
        type: "backend_development",
        risk: input.risk,
        deps: [t1],
        acceptance: ["Storage layer implemented behind an interface", "State survives basic workflow (as applicable)"]
      })
    );
  }

  tasks.push(
    task({
      id: t3,
      title: `Backend implementation (endpoints + logic): ${shortTitle}`,
      type: "backend_development",
      risk: input.risk,
      deps: [t1, t2],
      acceptance: looksLikeTodoApp(input.requestText)
        ? ["Create/list/update/delete todos", "Complete/uncomplete flow works"]
        : ["Core feature implemented end-to-end", "Error handling + validation included"]
    })
  );

  if (wantsFrontend(input.requestText)) {
    tasks.push(
      task({
        id: t4,
        title: `Frontend UI: ${shortTitle}`,
        type: "frontend_development",
        risk: input.risk,
        deps: [t3],
        acceptance: looksLikeTodoApp(input.requestText)
          ? ["Todo list renders", "Add/edit/complete/delete flows work"]
          : ["UI flows implemented", "Basic UX states (loading/empty/error) handled"]
      })
    );
  } else {
    tasks.push(
      task({
        id: t4,
        title: `API documentation + examples: ${shortTitle}`,
        type: "api_docs",
        risk: input.risk,
        deps: [t3],
        acceptance: ["API docs include request/response examples", "How to run locally documented"]
      })
    );
  }

  tasks.push(
    task({
      id: t5,
      title: `Tests (unit + integration): ${shortTitle}`,
      type: "integration_tests",
      risk: input.risk,
      deps: [t3, t4],
      acceptance: ["Happy path covered", "At least one error/edge case covered"]
    })
  );

  tasks.push(
    task({
      id: t6,
      title: `Review + hardening: ${shortTitle}`,
      type: reviewType,
      risk: input.risk,
      deps: [t5],
      acceptance: ["No obvious security footguns", "Complexity reduced where possible"]
    })
  );

  return {
    version: "tasks.v1",
    project: { name: input.projectName },
    plan_id: input.planId,
    repo_commit: "DEV",
    defaults: {
      context: { graph_depth: 2, top_k: 16, max_files: 40, max_lines: 1800 },
      verify: { gates_mode: "standard" },
      fix_loop: { max_iters: 3 }
    },
    phases: [
      {
        id: "phase-1",
        name: "Implementation",
        tasks
      }
    ]
  };
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }
  return null;
}

function ensureArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function normalizeTasksFile(input: {
  raw: any;
  planId: string;
  projectName: string;
  defaultRisk: RiskLevel;
  allowedTaskTypes: string[];
}): TasksFileV1 {
  const raw = input.raw ?? {};

  const phasesRaw = Array.isArray(raw.phases) ? raw.phases : Array.isArray(raw) ? raw : [];
  const phases = phasesRaw.map((p: any, phaseIdx: number) => {
    const tasksRaw = ensureArray<any>(p?.tasks);
    const tasks = tasksRaw.map((t: any, taskIdx: number) => {
      const id = typeof t?.id === "string" && t.id.trim() ? t.id.trim() : makeTaskId(taskIdx + 1);
      const title =
        typeof t?.title === "string" && t.title.trim()
          ? t.title.trim()
          : `Task ${id} (${input.projectName})`;
      const type =
        typeof t?.type === "string" && input.allowedTaskTypes.includes(t.type)
          ? t.type
          : "backend_development";
      const risk =
        t?.risk === "low" || t?.risk === "standard" || t?.risk === "high" ? (t.risk as RiskLevel) : input.defaultRisk;
      const deps = ensureArray<string>(t?.deps).filter((d) => typeof d === "string");
      const scope = t?.scope && typeof t.scope === "object" ? t.scope : {};
      const acceptance = ensureArray<string>(t?.acceptance).filter((a) => typeof a === "string" && a.trim());

      return task({
        id,
        title,
        type,
        risk,
        deps,
        scope,
        acceptance: acceptance.length > 0 ? acceptance : ["Acceptance criteria pending"]
      });
    });

    return {
      id: typeof p?.id === "string" && p.id.trim() ? p.id.trim() : `phase-${phaseIdx + 1}`,
      name: typeof p?.name === "string" && p.name.trim() ? p.name.trim() : `Phase ${phaseIdx + 1}`,
      tasks
    };
  });

  if (phases.length === 0) {
    throw new Error("No phases found in tasks JSON.");
  }

  return {
    version: "tasks.v1",
    project: { name: input.projectName },
    plan_id: input.planId,
    repo_commit: "DEV",
    defaults: raw.defaults && typeof raw.defaults === "object" ? raw.defaults : {},
    phases
  };
}

export async function generateTasksForPlan(input: {
  provider: IModelProvider;
  model: string;
  planId: string;
  projectName: string;
  requestText: string;
  inputFiles: PlanInputFile[];
  lane: Lane;
  risk: RiskLevel;
  allowedTaskTypes: string[];
}): Promise<{
  tasks: TasksFileV1;
  source: "model" | "heuristic";
  warnings: string[];
  usage?: ChatCompletionResponse["usage"];
}> {
  const warnings: string[] = [];

  const safeRequest = clampString(redactText(input.requestText).text, 12000);
  const safeFiles = input.inputFiles
    .slice(0, 3)
    .map((f) => ({
      path: String(f.path ?? ""),
      content: clampString(redactText(String(f.content ?? "")).text, 8000)
    }))
    .filter((f) => f.path && f.content);

  // In mock mode we want deterministic behavior without pretending to be an LLM planner.
  if (input.provider.name === "mock") {
    return {
      tasks: buildHeuristicTasks({
        planId: input.planId,
        projectName: input.projectName,
        requestText: safeRequest,
        lane: input.lane,
        risk: input.risk
      }),
      source: "heuristic",
      warnings
    };
  }

  const system = [
    "You are a senior software engineer acting as a project planner.",
    "Return ONLY valid JSON, no markdown, no prose.",
    'Output must conform to "tasks.v1" structure with: version, project{name}, plan_id, phases[].',
    "Each task must include: id, title, type, risk (low|standard|high), deps[], scope{}, acceptance[], execution{}, outputs{}.",
    `Allowed task types: ${input.allowedTaskTypes.join(", ")}.`
  ].join("\n");

  const user = [
    `Project: ${input.projectName}`,
    `Request: ${safeRequest || "(empty)"}`,
    safeFiles.length > 0 ? "Input Files:" : null,
    ...safeFiles.flatMap((f) => [`--- ${f.path} ---`, f.content]),
    "",
    "Generate 1-3 phases and 5-12 tasks.",
    "Task ids must be stable like task-001, task-002, ...",
    "Use repo-relative scope.paths globs where possible."
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const completion = await input.provider.chat({
      model: input.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.2,
      max_tokens: 4096
    });

    const jsonText = extractJson(completion.content) ?? completion.content.trim();
    try {
      const parsed = JSON.parse(jsonText);
      const tasks = normalizeTasksFile({
        raw: parsed,
        planId: input.planId,
        projectName: input.projectName,
        defaultRisk: input.risk,
        allowedTaskTypes: input.allowedTaskTypes
      });
      return { tasks, source: "model", warnings, usage: completion.usage };
    } catch (err) {
      warnings.push(`Planner JSON parse/normalize failed; falling back to heuristic. (${(err as Error).message})`);
      return {
        tasks: buildHeuristicTasks({
          planId: input.planId,
          projectName: input.projectName,
          requestText: safeRequest,
          lane: input.lane,
          risk: input.risk
        }),
        source: "heuristic",
        warnings,
        usage: completion.usage
      };
    }
  } catch (err) {
    warnings.push(`Planner model call failed; falling back to heuristic. (${(err as Error).message})`);
    return {
      tasks: buildHeuristicTasks({
        planId: input.planId,
        projectName: input.projectName,
        requestText: safeRequest,
        lane: input.lane,
        risk: input.risk
      }),
      source: "heuristic",
      warnings
    };
  }
}

