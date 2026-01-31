import path from "path";
import { describe, expect, it } from "vitest";
import {
  decideRouter,
  loadLanePolicy,
  loadModelStack,
  loadRiskPolicy,
  loadPricing,
  calculateCost
} from "@trcoder/shared";

const repoRoot = path.resolve(__dirname, "../../..");

const modelStack = loadModelStack(path.join(repoRoot, "config", "model-stack.v2.json"));
const lanePolicy = loadLanePolicy(path.join(repoRoot, "config", "lane-policy.v1.yaml"));
const riskPolicy = loadRiskPolicy(path.join(repoRoot, "config", "risk-policy.v1.yaml"));


describe("router decision", () => {
  it("enforces min tier for high risk", () => {
    const decision = decideRouter({
      taskType: "backend_development",
      lane: "balanced",
      risk: "high",
      budgetRemainingUsd: 10,
      modelStack,
      lanePolicy,
      riskPolicy
    });

    const tier = modelStack.models[decision.selected_model].tier;
    expect(["premium", "premium_reasoning"]).toContain(tier);
  });
});

describe("cost calculator", () => {
  it("applies markup", () => {
    const pricing = loadPricing(path.join(repoRoot, "config", "pricing.v1.yaml"));
    const result = calculateCost({
      model: "claude-sonnet-4.5",
      tokens_in: 1000,
      tokens_out: 500,
      pricing: pricing as any,
      modelStack,
      plan_id: "pro_solo",
      credits_remaining_trc: 0
    });
    expect(result.provider_cost_usd).toBeGreaterThan(0);
    expect(result.our_charge_usd).toBeGreaterThan(result.provider_cost_usd);
  });
});
