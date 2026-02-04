import fs from "fs";
import path from "path";
import os from "os";

export function getDataDir(): string {
  const override = process.env.TRCODER_DATA_DIR;
  const base = override
    ? path.isAbsolute(override)
      ? override
      : path.join(process.cwd(), override)
    : path.join(os.homedir(), ".trcoder");
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return base;
}

export function getArtifactsDir(): string {
  const override = process.env.TRCODER_ARTIFACTS_DIR;
  const dir = override
    ? path.isAbsolute(override)
      ? override
      : path.join(process.cwd(), override)
    : path.join(getDataDir(), "artifacts");
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
