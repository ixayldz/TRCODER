import path from "path";
import { describe, expect, it } from "vitest";
import {
  loadLanePolicy,
  loadModelStack,
  loadPricing,
  loadRiskPolicy
} from "@trcoder/shared";

const repoRoot = path.resolve(__dirname, "../../..");

describe("config loaders", () => {
  it("loads model stack and policies", () => {
    const model = loadModelStack(path.join(repoRoot, "config", "model-stack.v2.json"));
    const lane = loadLanePolicy(path.join(repoRoot, "config", "lane-policy.v1.yaml"));
    const risk = loadRiskPolicy(path.join(repoRoot, "config", "risk-policy.v1.yaml"));
    const pricing = loadPricing(path.join(repoRoot, "config", "pricing.v1.yaml"));

    expect(model.version).toBe("model-stack.v2");
    expect(lane.version).toBe("lane-policy.v1");
    expect(risk.version).toBe("risk-policy.v1");
    expect(pricing.version).toBe("pricing.v1");
  });
});
