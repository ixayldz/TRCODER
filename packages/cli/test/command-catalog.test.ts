import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { getHelpLines, HELP_MAP } from "../src/help";

const repoRoot = path.resolve(__dirname, "../../..");

function extractDocCommands(text: string): string[] {
  const matches = Array.from(text.matchAll(/`([^`]+)`/g)).map((m) => m[1]);
  return matches.filter((cmd) => cmd.startsWith("/"));
}

function tokenize(command: string): string[] {
  return command
    .split(/\s+/)
    .map((token) => token.replace(/\[|\]/g, ""))
    .map((token) => token.replace(/<[^>]+>/g, ""))
    .map((token) => token.replace(/["']/g, ""))
    .map((token) => token.trim())
    .filter((token) => token && token !== "|")
    .filter((token) => !/^[A-Z][A-Z0-9:_-]*$/.test(token));
}

function tokensInOrder(text: string, tokens: string[]): boolean {
  let idx = 0;
  for (const token of tokens) {
    const next = text.indexOf(token, idx);
    if (next === -1) return false;
    idx = next + token.length;
  }
  return true;
}

describe("command catalog coverage", () => {
  it("help output covers documented commands", () => {
    const doc = fs.readFileSync(path.join(repoRoot, "docs", "command-catalog.md"), "utf8");
    const commands = extractDocCommands(doc);
    const helpCorpus = [...getHelpLines(), ...Object.values(HELP_MAP)];

    for (const cmd of commands) {
      const tokens = tokenize(cmd);
      const matched = helpCorpus.some((line) => tokensInOrder(line, tokens));
      expect(
        matched,
        `Missing help coverage for command: ${cmd} (tokens: ${tokens.join(" ")})`
      ).toBe(true);
    }
  });
});
