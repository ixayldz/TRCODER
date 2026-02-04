import fs from "fs";
import path from "path";
import { spawn } from "child_process";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLocalhost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function findRepoRoot(startDir: string): string | null {
  let current = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(current, "packages", "server", "dist", "index.js");
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function loadDotenv(dotenvPath: string): Record<string, string> {
  if (!fs.existsSync(dotenvPath)) return {};
  const out: Record<string, string> = {};
  const lines = fs.readFileSync(dotenvPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

async function canReachServer(serverUrl: string, apiKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    await fetch(`${serverUrl}/v1/whoami`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureLocalServerRunning(input: {
  serverUrl: string;
  apiKey: string;
  log?: (message: string) => void;
}): Promise<void> {
  const auto = (process.env.TRCODER_AUTO_SERVER ?? "true").toLowerCase() !== "false";
  if (!auto) return;
  if (!isLocalhost(input.serverUrl)) return;

  if (await canReachServer(input.serverUrl, input.apiKey)) return;

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    input.log?.("Local server not reachable; repo root not found to auto-start server.");
    return;
  }

  const entry = path.join(repoRoot, "packages", "server", "dist", "index.js");
  if (!fs.existsSync(entry)) {
    input.log?.("Local server dist not found. Run: pnpm -C packages/server build");
    return;
  }

  const env = {
    ...process.env,
    ...loadDotenv(path.join(repoRoot, ".env"))
  };

  const child = spawn(process.execPath, [entry], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  input.log?.(`Local server started (pid ${child.pid ?? "n/a"}).`);

  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await canReachServer(input.serverUrl, input.apiKey)) return;
    await sleep(200);
  }
  input.log?.("Local server did not become reachable yet. If needed, start it manually: node packages/server/dist/index.js");
}

