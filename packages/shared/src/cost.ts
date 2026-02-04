import { CostBreakdown, CostInput, ModelPricing } from "./types";

export const MODEL_PRICING_USD_PER_1K: Record<string, ModelPricing> = {
  "gpt-5.2-xhigh": { input_per_1k: 0.03, output_per_1k: 0.06 },
  "claude-opus-4.5": { input_per_1k: 0.025, output_per_1k: 0.05 },
  "claude-sonnet-4.5": { input_per_1k: 0.01, output_per_1k: 0.03 },
  "gemini-3.0-pro": { input_per_1k: 0.008, output_per_1k: 0.024 }
};

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING_USD_PER_1K[model] ?? { input_per_1k: 0.01, output_per_1k: 0.03 };
}

export function estimateTokens(taskType: string, lane: string, risk: string): number {
  let base = 8000;
  if (taskType.includes("review")) base = 6000;
  if (taskType.includes("integration")) base = 12000;
  if (taskType.includes("architecture")) base = 14000;
  if (taskType.includes("frontend")) base = 10000;

  if (lane === "speed" || lane === "cost-saver") base *= 0.8;
  if (lane === "quality") base *= 1.2;
  if (risk === "high") base *= 1.25;

  return Math.round(base);
}

export function estimateProviderCostUsd(model: string, totalTokens: number): number {
  const pricing = getModelPricing(model);
  const avgPer1k = (pricing.input_per_1k + pricing.output_per_1k) / 2;
  return (totalTokens / 1000) * avgPer1k;
}

export function calculateCost(input: CostInput): CostBreakdown {
  const pricing = getModelPricing(input.model);
  const provider_cost_usd =
    (input.tokens_in / 1000) * pricing.input_per_1k +
    (input.tokens_out / 1000) * pricing.output_per_1k;

  const modelTier = input.modelStack.models[input.model]?.tier ?? "standard";
  const plan = input.plan_id ? input.pricing.plans[input.plan_id] : undefined;
  const markupTable = plan ? plan.payg_markup : input.pricing.payg_only.markup;
  const markup = markupTable[modelTier === "premium_reasoning" ? "premium" : modelTier];

  const credits_remaining = input.credits_remaining_trc ?? 0;
  const credits_applied_usd = Math.min(provider_cost_usd, credits_remaining);
  const billable_provider_cost_usd = Math.max(0, provider_cost_usd - credits_applied_usd);
  const credits_used_trc = credits_applied_usd;
  const payg_overage_usd = billable_provider_cost_usd;
  const our_charge_usd = billable_provider_cost_usd * (1 + markup);
  const effective_markup =
    billable_provider_cost_usd > 0 ? our_charge_usd / billable_provider_cost_usd - 1 : 0;

  return {
    provider_cost_usd,
    credits_applied_usd,
    billable_provider_cost_usd,
    our_charge_usd,
    credits_used_trc,
    payg_overage_usd,
    markup_rate: markup,
    effective_markup
  };
}
