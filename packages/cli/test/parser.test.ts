import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "../src/parser";

describe("slash command parser", () => {
  it("parses basic command and args", () => {
    const parsed = parseSlashCommand("/plan from @docs/prd.md");
    expect(parsed?.command).toBe("plan");
    expect(parsed?.args).toEqual(["from", "@docs/prd.md"]);
  });

  it("handles quoted arguments", () => {
    const parsed = parseSlashCommand('/permissions allow "git status"');
    expect(parsed?.command).toBe("permissions");
    expect(parsed?.args).toEqual(["allow", "git status"]);
  });

  it("ignores non-slash input", () => {
    const parsed = parseSlashCommand("hello world");
    expect(parsed).toBeNull();
  });
});
