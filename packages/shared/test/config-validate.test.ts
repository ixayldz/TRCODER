import { describe, expect, it } from "vitest";
import {
  validateLanePolicy,
  validateModelStack,
  validateRiskPolicy,
  ModelStackConfig,
  LanePolicyConfig,
  RiskPolicyConfig
} from "@trcoder/shared";

function baseModelStack(): ModelStackConfig {
  return {
    version: "model-stack.v2",
    models: {
      "model-standard": { provider: "mock", tier: "standard" },
      "model-premium": { provider: "mock", tier: "premium" }
    },
    task_type_map: {
      backend_development: { model: "model-standard", reason: "default" }
    },
    fallback_chains: {
      "model-standard": ["model-premium"]
    }
  };
}

function baseLanePolicy(): LanePolicyConfig {
  return {
    version: "lane-policy.v1",
    lanes: {
      speed: {
        context_budget: { max_files: 20, max_lines: 900, graph_depth: 1, top_k: 10, hydrate: false },
        verify_mode: "targeted",
        fix_loop_max_iters: 2,
        model_overrides: {}
      },
      balanced: {
        context_budget: { max_files: 40, max_lines: 1800, graph_depth: 2, top_k: 16, hydrate: false },
        verify_mode: "standard",
        fix_loop_max_iters: 3,
        model_overrides: {}
      },
      quality: {
        context_budget: { max_files: 60, max_lines: 2600, graph_depth: 3, top_k: 24, hydrate: true },
        verify_mode: "strict",
        fix_loop_max_iters: 3,
        model_overrides: {}
      },
      "cost-saver": {
        context_budget: { max_files: 25, max_lines: 1200, graph_depth: 1, top_k: 12, hydrate: false },
        verify_mode: "standard",
        fix_loop_max_iters: 2,
        model_overrides: {}
      }
    }
  };
}

function baseRiskPolicy(): RiskPolicyConfig {
  return {
    version: "risk-policy.v1",
    risk_levels: {
      low: {
        downgrade_allowed: true,
        min_allowed_tier: "standard",
        verify_strictness: "standard"
      },
      standard: {
        downgrade_allowed: true,
        min_allowed_tier: "standard",
        verify_strictness: "standard"
      },
      high: {
        downgrade_allowed: false,
        min_allowed_tier: "premium",
        verify_strictness: "strict",
        requires_confirmation: true
      }
    },
    high_risk_task_types: [],
    high_risk_path_patterns: []
  };
}

describe("config validation", () => {
  it("flags unknown model references in task_type_map", () => {
    const modelStack = baseModelStack();
    modelStack.task_type_map.backend_development.model = "missing-model";
    const result = validateModelStack(modelStack);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("references unknown model");
  });

  it("flags unknown model references in fallback chains", () => {
    const modelStack = baseModelStack();
    modelStack.fallback_chains["model-standard"] = ["missing-model"];
    const result = validateModelStack(modelStack);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("fallback_chains");
  });

  it("flags lane overrides that reference unknown models", () => {
    const modelStack = baseModelStack();
    const lanePolicy = baseLanePolicy();
    lanePolicy.lanes.speed.model_overrides = { backend_development: "missing-model" };
    const result = validateLanePolicy(lanePolicy, modelStack);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("override");
  });

  it("flags risk policy when no model meets min tier", () => {
    const modelStack = baseModelStack();
    const riskPolicy = baseRiskPolicy();
    riskPolicy.risk_levels.high.min_allowed_tier = "premium_reasoning";
    const result = validateRiskPolicy(riskPolicy, modelStack);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("no models satisfy");
  });
});
