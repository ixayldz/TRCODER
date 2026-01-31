import {
  Lane,
  LanePolicyConfig,
  ModelStackConfig,
  ModelTier,
  RiskLevel,
  RiskPolicyConfig,
  VerifyMode
} from "./types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const REQUIRED_LANES: Lane[] = ["speed", "balanced", "quality", "cost-saver"];
const REQUIRED_RISKS: RiskLevel[] = ["low", "standard", "high"];
const VALID_VERIFY_MODES: VerifyMode[] = ["targeted", "standard", "strict"];
const VALID_TIERS: ModelTier[] = ["premium_reasoning", "premium", "standard", "economy"];

const TIER_RANK: Record<ModelTier, number> = {
  economy: 1,
  standard: 2,
  premium: 3,
  premium_reasoning: 4
};

function resultBase(): ValidationResult {
  return { ok: true, errors: [], warnings: [] };
}

function addError(result: ValidationResult, message: string) {
  result.ok = false;
  result.errors.push(message);
}

function addWarning(result: ValidationResult, message: string) {
  result.warnings.push(message);
}

function ensureArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function meetsMinTier(modelStack: ModelStackConfig, model: string, minTier: ModelTier): boolean {
  const tier = modelStack.models[model]?.tier ?? "standard";
  return TIER_RANK[tier] >= TIER_RANK[minTier];
}

export function validateModelStack(modelStack: ModelStackConfig): ValidationResult {
  const result = resultBase();
  const modelNames = Object.keys(modelStack.models ?? {});

  if (!modelStack.models || modelNames.length === 0) {
    addError(result, "model-stack: models list is empty.");
    return result;
  }

  for (const [model, info] of Object.entries(modelStack.models)) {
    if (!info?.tier || !VALID_TIERS.includes(info.tier)) {
      addError(result, `model-stack: model "${model}" has invalid tier "${info?.tier ?? "missing"}".`);
    }
    if (!info?.provider) {
      addWarning(result, `model-stack: model "${model}" missing provider.`);
    }
  }

  if (modelStack.task_type_map) {
    for (const [taskType, entry] of Object.entries(modelStack.task_type_map)) {
      if (!entry?.model) {
        addError(result, `model-stack: task_type_map "${taskType}" missing model.`);
        continue;
      }
      if (!modelStack.models[entry.model]) {
        addError(result, `model-stack: task_type_map "${taskType}" references unknown model "${entry.model}".`);
      }
    }
  }

  if (modelStack.fallback_chains) {
    for (const [model, chain] of Object.entries(modelStack.fallback_chains)) {
      if (!modelStack.models[model]) {
        addError(result, `model-stack: fallback_chains has unknown base model "${model}".`);
      }
      if (!ensureArray(chain)) {
        addError(result, `model-stack: fallback_chains "${model}" must be an array.`);
        continue;
      }
      const seen = new Set<string>();
      for (const fallback of chain) {
        if (typeof fallback !== "string") {
          addError(result, `model-stack: fallback_chains "${model}" contains non-string entry.`);
          continue;
        }
        if (!modelStack.models[fallback]) {
          addError(result, `model-stack: fallback_chains "${model}" references unknown model "${fallback}".`);
        }
        if (fallback === model) {
          addWarning(result, `model-stack: fallback_chains "${model}" includes itself.`);
        }
        if (seen.has(fallback)) {
          addWarning(result, `model-stack: fallback_chains "${model}" has duplicate entry "${fallback}".`);
        }
        seen.add(fallback);
      }
    }
  }

  return result;
}

export function validateLanePolicy(
  lanePolicy: LanePolicyConfig,
  modelStack: ModelStackConfig
): ValidationResult {
  const result = resultBase();
  const laneKeys = Object.keys(lanePolicy.lanes ?? {});

  for (const lane of REQUIRED_LANES) {
    if (!lanePolicy.lanes?.[lane]) {
      addError(result, `lane-policy: missing lane "${lane}".`);
    }
  }

  for (const laneName of laneKeys) {
    if (!REQUIRED_LANES.includes(laneName as Lane)) {
      addWarning(result, `lane-policy: unknown lane "${laneName}".`);
    }
    const lane = lanePolicy.lanes[laneName as Lane];
    if (!lane) continue;

    if (!lane.context_budget) {
      addError(result, `lane-policy: lane "${laneName}" missing context_budget.`);
    } else {
      const { max_files, max_lines, graph_depth, top_k } = lane.context_budget;
      if (max_files <= 0) addError(result, `lane-policy: lane "${laneName}" max_files must be > 0.`);
      if (max_lines <= 0) addError(result, `lane-policy: lane "${laneName}" max_lines must be > 0.`);
      if (graph_depth <= 0) addError(result, `lane-policy: lane "${laneName}" graph_depth must be > 0.`);
      if (top_k <= 0) addError(result, `lane-policy: lane "${laneName}" top_k must be > 0.`);
    }

    if (!VALID_VERIFY_MODES.includes(lane.verify_mode)) {
      addError(result, `lane-policy: lane "${laneName}" has invalid verify_mode "${lane.verify_mode}".`);
    }

    if (lane.fix_loop_max_iters <= 0) {
      addError(result, `lane-policy: lane "${laneName}" fix_loop_max_iters must be > 0.`);
    }

    if (lane.model_overrides) {
      for (const [taskType, model] of Object.entries(lane.model_overrides)) {
        if (!modelStack.models[model]) {
          addError(
            result,
            `lane-policy: lane "${laneName}" override for "${taskType}" references unknown model "${model}".`
          );
        }
      }
    }

    if (lane.review_burst?.enabled && lane.review_burst.reviewer_task_type) {
      const reviewerType = lane.review_burst.reviewer_task_type;
      if (!modelStack.task_type_map?.[reviewerType]) {
        addWarning(
          result,
          `lane-policy: lane "${laneName}" reviewer_task_type "${reviewerType}" not found in task_type_map.`
        );
      }
    }
  }

  return result;
}

export function validateRiskPolicy(
  riskPolicy: RiskPolicyConfig,
  modelStack: ModelStackConfig
): ValidationResult {
  const result = resultBase();

  for (const level of REQUIRED_RISKS) {
    if (!riskPolicy.risk_levels?.[level]) {
      addError(result, `risk-policy: missing risk level "${level}".`);
    }
  }

  for (const [riskName, policy] of Object.entries(riskPolicy.risk_levels ?? {})) {
    if (!REQUIRED_RISKS.includes(riskName as RiskLevel)) {
      addWarning(result, `risk-policy: unknown risk level "${riskName}".`);
    }

    if (!VALID_TIERS.includes(policy.min_allowed_tier)) {
      addError(
        result,
        `risk-policy: risk "${riskName}" has invalid min_allowed_tier "${policy.min_allowed_tier}".`
      );
    }
    if (!VALID_VERIFY_MODES.includes(policy.verify_strictness)) {
      addError(
        result,
        `risk-policy: risk "${riskName}" has invalid verify_strictness "${policy.verify_strictness}".`
      );
    }
  }

  if (!ensureArray(riskPolicy.high_risk_task_types)) {
    addError(result, "risk-policy: high_risk_task_types must be an array.");
  }
  if (!ensureArray(riskPolicy.high_risk_path_patterns)) {
    addError(result, "risk-policy: high_risk_path_patterns must be an array.");
  }

  for (const [riskName, policy] of Object.entries(riskPolicy.risk_levels ?? {})) {
    if (!VALID_TIERS.includes(policy.min_allowed_tier)) continue;
    const meets = Object.keys(modelStack.models ?? {}).some((model) =>
      meetsMinTier(modelStack, model, policy.min_allowed_tier)
    );
    if (!meets) {
      addError(
        result,
        `risk-policy: risk "${riskName}" requires min tier "${policy.min_allowed_tier}" but no models satisfy it.`
      );
    }
  }

  return result;
}

export function validateAllConfig(input: {
  modelStack: ModelStackConfig;
  lanePolicy: LanePolicyConfig;
  riskPolicy: RiskPolicyConfig;
}): ValidationResult {
  const modelResult = validateModelStack(input.modelStack);
  const laneResult = validateLanePolicy(input.lanePolicy, input.modelStack);
  const riskResult = validateRiskPolicy(input.riskPolicy, input.modelStack);

  const errors = [...modelResult.errors, ...laneResult.errors, ...riskResult.errors];
  const warnings = [...modelResult.warnings, ...laneResult.warnings, ...riskResult.warnings];
  return { ok: errors.length === 0, errors, warnings };
}

export function assertValidConfig(input: {
  modelStack: ModelStackConfig;
  lanePolicy: LanePolicyConfig;
  riskPolicy: RiskPolicyConfig;
}): void {
  const result = validateAllConfig(input);
  if (result.errors.length > 0) {
    const detail = result.errors.map((err) => `- ${err}`).join("\n");
    throw new Error(`Config validation failed:\n${detail}`);
  }
}
