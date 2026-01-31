import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server";

const repoRoot = path.resolve(__dirname, "../../..");

function parseDocRoutes(text: string): Set<string> {
  const routes = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^- (GET|POST|WS)\s+([^\s)]+)/);
    if (match) {
      const pathOnly = match[2].split("?")[0];
      routes.add(`${match[1]} ${pathOnly}`);
    }
  }
  return routes;
}

describe("api contract coverage", () => {
  it("docs/api-contract.md matches server routes", async () => {
    const actual = new Set<string>();
    const { app } = await createServer({
      onRoute: (route) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) {
          if (method === "GET" || method === "POST") {
            actual.add(`${method} ${route.url}`);
          }
        }
      }
    });
    await app.ready();
    const doc = fs.readFileSync(path.join(repoRoot, "docs", "api-contract.md"), "utf8");
    const expected = parseDocRoutes(doc);
    actual.add("WS /v1/runner/ws");

    const missing = Array.from(expected).filter((route) => !actual.has(route));
    const extras = Array.from(actual).filter((route) => !expected.has(route));

    await app.close();

    expect(missing, `Missing routes: ${missing.join(", ")}`).toEqual([]);
    expect(extras, `Undocumented routes: ${extras.join(", ")}`).toEqual([]);
  });
});
