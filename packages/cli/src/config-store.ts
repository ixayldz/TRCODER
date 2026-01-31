import fs from "fs";
import path from "path";
import os from "os";
import { ContextPackManifest, ContextBudget, Lane, RiskLevel } from "@trcoder/shared";

export interface CliConfig {
  server_url: string;
  api_key: string;
  project_id?: string;
  last_plan_id?: string;
  lane?: Lane;
  risk?: RiskLevel;
  budget_cap_usd?: number;
  context_override?: ContextBudget;
  last_run_id?: string;
  last_task_id?: string;
  last_patch?: { path?: string; text?: string; summary?: string };
  last_context_pack?: ContextPackManifest;
  storage?: { method: "file" | "keychain"; encrypted: boolean };
  pins?: string[];
  fix_loop_max_iters?: number;
}

const DEFAULT_CONFIG: CliConfig = {
  server_url: "http://127.0.0.1:3333",
  api_key: "dev",
  storage: { method: "file", encrypted: false }
};

export function getConfigPath(): string {
  const dir = path.join(os.homedir(), ".trcoder");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, "cli.json");
}

export function loadConfig(): CliConfig {
  const filePath = getConfigPath();
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw) as CliConfig;
  return { ...DEFAULT_CONFIG, ...data };
}

export function saveConfig(config: CliConfig): void {
  const filePath = getConfigPath();
  const withDefaults = { ...config, storage: config.storage ?? { method: "file", encrypted: false } };
  fs.writeFileSync(filePath, JSON.stringify(withDefaults, null, 2));
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // best-effort
    }
  }
}
