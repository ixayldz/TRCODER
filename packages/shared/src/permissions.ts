import { PermissionsConfig } from "./types";

export type PermissionClass = "allow" | "ask" | "deny";

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = `^${escaped.replace(/\*/g, ".*")}$`;
  return new RegExp(regex);
}

function matchesAny(patterns: string[], command: string): boolean {
  return patterns.some((pattern) => patternToRegex(pattern).test(command));
}

export function classifyCommand(command: string, policy: PermissionsConfig): PermissionClass {
  if (matchesAny(policy.deny, command)) return "deny";
  if (matchesAny(policy.ask, command)) return "ask";
  if (matchesAny(policy.allow, command)) return "allow";
  return "ask";
}
