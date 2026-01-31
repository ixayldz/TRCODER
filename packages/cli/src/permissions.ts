import fs from "fs";
import path from "path";
import os from "os";
import { PermissionsConfig, loadPermissions } from "@trcoder/shared";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, "config", "permissions.defaults.yaml");
    if (fs.existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

export function loadPermissionPolicy(): PermissionsConfig {
  const repoRoot = findRepoRoot(process.cwd());
  const defaults = loadPermissions(path.join(repoRoot, "config", "permissions.defaults.yaml"));
  const overridePath = path.join(os.homedir(), ".trcoder", "permissions.json");
  if (!fs.existsSync(overridePath)) {
    return defaults;
  }
  const override = JSON.parse(fs.readFileSync(overridePath, "utf8")) as Partial<PermissionsConfig>;
  return {
    version: defaults.version,
    allow: override.allow ?? defaults.allow,
    ask: override.ask ?? defaults.ask,
    deny: override.deny ?? defaults.deny
  };
}
