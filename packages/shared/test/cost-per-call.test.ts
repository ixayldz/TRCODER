import { describe, expect, it } from "vitest";
import { calculateCost, ModelStackConfig, PricingConfig } from "@trcoder/shared";

describe("cost per call", () => {
  it("applies credits before markup", () => {
    const pricing: PricingConfig = {
      version: "pricing.v1",
      plans: {
        test: {
          monthly_price_usd: 0,
          included_credits_trc: 0,
          payg_markup: { standard: 0.5, premium: 0.5, economy: 0.5 }
        }
      },
      payg_only: {
        enabled: true,
        minimum_monthly_charge_usd: 0,
        markup: { standard: 0.5, premium: 0.5, economy: 0.5 }
      },
      credit_definition: { trc_equals_provider_cost_usd: 1 }
    };

    const modelStack: ModelStackConfig = {
      version: "model-stack.v2",
      models: { "mock-model": { provider: "mock", tier: "standard" } },
      task_type_map: {},
      fallback_chains: {}
    };

    const result = calculateCost({
      model: "mock-model",
      tokens_in: 1000,
      tokens_out: 0,
      pricing,
      modelStack,
      plan_id: "test",
      credits_remaining_trc: 1
    });

    expect(result.credits_applied_usd).toBeGreaterThan(0);
    expect(result.billable_provider_cost_usd).toBe(0);
    expect(result.our_charge_usd).toBe(0);
  });

  it("applies markup to billable provider cost", () => {
    const pricing: PricingConfig = {
      version: "pricing.v1",
      plans: {
        test: {
          monthly_price_usd: 0,
          included_credits_trc: 0,
          payg_markup: { standard: 0.5, premium: 0.5, economy: 0.5 }
        }
      },
      payg_only: {
        enabled: true,
        minimum_monthly_charge_usd: 0,
        markup: { standard: 0.5, premium: 0.5, economy: 0.5 }
      },
      credit_definition: { trc_equals_provider_cost_usd: 1 }
    };

    const modelStack: ModelStackConfig = {
      version: "model-stack.v2",
      models: { "mock-model": { provider: "mock", tier: "standard" } },
      task_type_map: {},
      fallback_chains: {}
    };

    const result = calculateCost({
      model: "mock-model",
      tokens_in: 1000,
      tokens_out: 0,
      pricing,
      modelStack,
      plan_id: "test",
      credits_remaining_trc: 0
    });

    expect(result.billable_provider_cost_usd).toBeGreaterThan(0);
    expect(result.our_charge_usd).toBeCloseTo(result.billable_provider_cost_usd * 1.5);
  });
});
