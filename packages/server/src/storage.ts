import fs from "fs";
import path from "path";
import os from "os";

export function getDataDir(): string {
  const base = path.join(os.homedir(), ".trcoder");
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return base;
}

export function getArtifactsDir(): string {
  const dir = path.join(getDataDir(), "artifacts");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
