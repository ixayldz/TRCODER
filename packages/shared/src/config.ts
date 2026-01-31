import fs from "fs";
import yaml from "yaml";
import {
  LanePolicyConfig,
  ModelStackConfig,
  PermissionsConfig,
  PricingConfig,
  RiskPolicyConfig,
  VerifyGatesConfig
} from "./types";

export function loadYamlFile<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, "utf8");
  return yaml.parse(content) as T;
}

export function loadJsonFile<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content) as T;
}

export function loadModelStack(filePath: string): ModelStackConfig {
  return loadJsonFile<ModelStackConfig>(filePath);
}

export function loadLanePolicy(filePath: string): LanePolicyConfig {
  return loadYamlFile<LanePolicyConfig>(filePath);
}

export function loadRiskPolicy(filePath: string): RiskPolicyConfig {
  return loadYamlFile<RiskPolicyConfig>(filePath);
}

export function loadPricing(filePath: string): PricingConfig {
  return loadYamlFile<PricingConfig>(filePath);
}

export function loadPermissions(filePath: string): PermissionsConfig {
  return loadYamlFile<PermissionsConfig>(filePath);
}

export function loadVerifyGates(filePath: string): VerifyGatesConfig {
  return loadYamlFile<VerifyGatesConfig>(filePath);
}
