export type Lane = "speed" | "balanced" | "quality" | "cost-saver";
export type RiskLevel = "low" | "standard" | "high";
export type VerifyMode = "targeted" | "standard" | "strict";

export type ModelTier = "premium_reasoning" | "premium" | "standard" | "economy";

export interface ModelStackConfig {
  version: string;
  models: Record<string, { provider: string; tier: ModelTier }>;
  task_type_map: Record<string, { model: string; reason: string }>;
  fallback_chains: Record<string, string[]>;
}

export interface LanePolicyConfig {
  version: string;
  lanes: Record<
    Lane,
    {
      context_budget: ContextBudget;
      verify_mode: VerifyMode;
      fix_loop_max_iters: number;
      model_overrides?: Record<string, string>;
      downgrade_bias?: boolean;
      review_burst?: { enabled: boolean; reviewer_task_type: string };
    }
  >;
}

export interface RiskPolicyConfig {
  version: string;
  risk_levels: Record<
    RiskLevel,
    {
      downgrade_allowed: boolean;
      min_allowed_tier: ModelTier;
      verify_strictness: VerifyMode;
      requires_confirmation?: boolean;
    }
  >;
  high_risk_task_types: string[];
  high_risk_path_patterns: string[];
}

export interface PricingConfig {
  version: string;
  plans: Record<
    string,
    {
      monthly_price_usd: number;
      included_credits_trc: number;
      payg_markup: Record<"standard" | "premium" | "economy", number>;
    }
  >;
  payg_only: {
    enabled: boolean;
    minimum_monthly_charge_usd: number;
    markup: Record<"standard" | "premium" | "economy", number>;
  };
  credit_definition: {
    trc_equals_provider_cost_usd: number;
  };
}

export interface PermissionsConfig {
  version: string;
  allow: string[];
  ask: string[];
  deny: string[];
}

export interface VerifyGatesConfig {
  version: string;
  modes: Record<VerifyMode, { gates: string[] }>;
  commands: Record<string, string>;
}

export interface TaskScope {
  paths?: string[];
  exclude_paths?: string[];
  symbols?: string[];
  queries?: string[];
}

export interface TaskDefinition {
  id: string;
  title: string;
  type: string;
  risk: RiskLevel;
  deps: string[];
  scope: TaskScope;
  acceptance: string[];
  execution: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export interface TasksPhase {
  id: string;
  name: string;
  tasks: TaskDefinition[];
}

export interface TasksFileV1 {
  version: "tasks.v1";
  project: { name: string };
  plan_id: string;
  repo_commit?: string;
  defaults?: Record<string, unknown>;
  phases: TasksPhase[];
}

export interface ContextBudget {
  max_files: number;
  max_lines: number;
  graph_depth: number;
  top_k: number;
  hydrate: boolean;
}

export interface ContextPackFileEntry {
  path: string;
  why: string;
  range?: { start_line: number; end_line: number };
  hash?: string;
}

export interface ContextPackSignals {
  failing_tests?: string[];
  logs?: string[];
  diff_summary?: string;
}

export interface ContextPackManifest {
  pack_id: string;
  task_id: string;
  run_id: string;
  mode: "manifest" | "hydrated";
  pinned_sources: string[];
  file_entries: ContextPackFileEntry[];
  signals: ContextPackSignals;
  budgets: ContextBudget;
  redaction_stats: { masked_entries: number; masked_chars: number };
}

export interface RouterDecision {
  selected_model: string;
  reasons: string[];
  expected_tokens: number;
  expected_cost_usd: number;
  fallback_chain: string[];
  downgrade_applied: boolean;
  budget_violation: boolean;
  constraints: string[];
}

export interface LedgerEvent {
  event_id: string;
  ts: string;
  org_id: string;
  user_id: string;
  project_id: string;
  run_id?: string | null;
  plan_id?: string | null;
  task_id?: string | null;
  event_type: LedgerEventType;
  payload: Record<string, unknown>;
}

export type LedgerEventType =
  | "RUN_STARTED"
  | "PLAN_CREATED"
  | "PLAN_APPROVED"
  | "TASK_STARTED"
  | "ROUTER_DECISION"
  | "CONTEXT_PACK_BUILT"
  | "LLM_CALL_STARTED"
  | "LLM_CALL_FINISHED"
  | "RUNNER_CMD_STARTED"
  | "RUNNER_CMD_FINISHED"
  | "VERIFY_STARTED"
  | "VERIFY_FINISHED"
  | "PATCH_PRODUCED"
  | "TASK_COMPLETED"
  | "RUN_COMPLETED"
  | "BILLING_POSTED"
  | "ANOMALY_DETECTED"
  | "RUN_PAUSED";

export interface CostBreakdown {
  provider_cost_usd: number;
  credits_applied_usd: number;
  billable_provider_cost_usd: number;
  our_charge_usd: number;
  credits_used_trc: number;
  payg_overage_usd: number;
  markup_rate: number;
  effective_markup: number;
}

export type RunState =
  | "INIT"
  | "RUNNING"
  | "PAUSED"
  | "FAILED"
  | "CANCELLED"
  | "DONE";

export type TaskStage =
  | "PREPARE_CONTEXT"
  | "DESIGN"
  | "IMPLEMENT_PATCH"
  | "LOCAL_VERIFY"
  | "SELF_REVIEW"
  | "PROPOSE_APPLY"
  | "TASK_DONE";

export interface RouterInput {
  taskType: string;
  lane: Lane;
  risk: RiskLevel;
  budgetRemainingUsd?: number;
  contextBudget?: ContextBudget;
  modelStack: ModelStackConfig;
  lanePolicy: LanePolicyConfig;
  riskPolicy: RiskPolicyConfig;
}

export interface ModelPricing {
  input_per_1k: number;
  output_per_1k: number;
}

export interface CostInput {
  model: string;
  tokens_in: number;
  tokens_out: number;
  pricing: PricingConfig;
  modelStack: ModelStackConfig;
  plan_id?: string;
  credits_remaining_trc?: number;
}
