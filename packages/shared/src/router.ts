import { estimateProviderCostUsd, estimateTokens } from "./cost";
import { ModelStackConfig, ModelTier, RouterDecision, RouterInput } from "./types";

const TIER_RANK: Record<ModelTier, number> = {
  economy: 1,
  standard: 2,
  premium: 3,
  premium_reasoning: 4
};

function meetsMinTier(modelStack: ModelStackConfig, model: string, minTier: ModelTier): boolean {
  const tier = modelStack.models[model]?.tier ?? "standard";
  return TIER_RANK[tier] >= TIER_RANK[minTier];
}

function pickModelForMinTier(
  modelStack: ModelStackConfig,
  minTier: ModelTier,
  preferModel?: string,
  tokensEstimate = 8000
): string {
  if (preferModel && meetsMinTier(modelStack, preferModel, minTier)) {
    return preferModel;
  }

  const candidates = Object.keys(modelStack.models).filter((model) =>
    meetsMinTier(modelStack, model, minTier)
  );

  if (candidates.length === 0) {
    return preferModel ?? Object.keys(modelStack.models)[0];
  }

  let best = candidates[0];
  let bestCost = estimateProviderCostUsd(best, tokensEstimate);
  for (const model of candidates.slice(1)) {
    const cost = estimateProviderCostUsd(model, tokensEstimate);
    if (cost < bestCost) {
      best = model;
      bestCost = cost;
    }
  }
  return best;
}

export function decideRouter(input: RouterInput): RouterDecision {
  const { taskType, lane, risk, budgetRemainingUsd, modelStack, lanePolicy, riskPolicy, contextBudget } =
    input;
  const reasons: string[] = [];
  const constraints: string[] = [];

  const base = modelStack.task_type_map[taskType]?.model ?? Object.keys(modelStack.models)[0];
  if (modelStack.task_type_map[taskType]?.reason) {
    reasons.push(modelStack.task_type_map[taskType].reason);
  } else {
    reasons.push("default model selection");
  }

  let selected = base;
  const laneOverride = lanePolicy.lanes[lane]?.model_overrides?.[taskType];
  if (laneOverride) {
    selected = laneOverride;
    reasons.push(`lane override: ${lane}`);
  }

  const minTier = riskPolicy.risk_levels[risk]?.min_allowed_tier ?? "standard";
  if (!meetsMinTier(modelStack, selected, minTier)) {
    const prior = selected;
    selected = pickModelForMinTier(modelStack, minTier, base);
    reasons.push(`risk floor applied: ${minTier}`);
    constraints.push(`min_allowed_tier:${minTier}`);
    if (selected !== prior) {
      reasons.push(`model adjusted for risk`);
    }
  }

  let expectedTokens = estimateTokens(taskType, lane, risk);
  if (contextBudget?.max_lines) {
    const scale = Math.min(1.5, Math.max(0.5, contextBudget.max_lines / 1800));
    expectedTokens = Math.round(expectedTokens * scale);
    reasons.push("context budget scaling");
  }
  let expectedCostUsd = estimateProviderCostUsd(selected, expectedTokens);

  let downgradeApplied = false;
  let budgetViolation = false;
  if (typeof budgetRemainingUsd === "number" && expectedCostUsd > budgetRemainingUsd) {
    const downgradeAllowed = riskPolicy.risk_levels[risk]?.downgrade_allowed ?? false;
    const downgradeBias = lanePolicy.lanes[lane]?.downgrade_bias ?? false;
    if (downgradeAllowed && (lane === "cost-saver" || downgradeBias)) {
      const cheaper = pickModelForMinTier(modelStack, minTier, undefined, expectedTokens);
      if (cheaper && cheaper !== selected) {
        selected = cheaper;
        expectedCostUsd = estimateProviderCostUsd(selected, expectedTokens);
        downgradeApplied = true;
        reasons.push("budget downgrade applied");
      }
    }

    if (expectedCostUsd > budgetRemainingUsd) {
      budgetViolation = true;
      constraints.push("budget_cap_exceeded");
    }
  }

  return {
    selected_model: selected,
    reasons,
    expected_tokens: expectedTokens,
    expected_cost_usd: expectedCostUsd,
    fallback_chain: modelStack.fallback_chains[selected] ?? [],
    downgrade_applied: downgradeApplied,
    budget_violation: budgetViolation,
    constraints
  };
}
