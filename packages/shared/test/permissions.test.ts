import path from "path";
import { describe, expect, it } from "vitest";
import { classifyCommand, loadPermissions } from "@trcoder/shared";

const repoRoot = path.resolve(__dirname, "../../..");

describe("permissions classifier", () => {
  it("denies dangerous commands", () => {
    const policy = loadPermissions(path.join(repoRoot, "config", "permissions.defaults.yaml"));
    expect(classifyCommand("rm -rf /", policy)).toBe("deny");
  });

  it("allows safe commands", () => {
    const policy = loadPermissions(path.join(repoRoot, "config", "permissions.defaults.yaml"));
    expect(classifyCommand("git status", policy)).toBe("allow");
  });
});
