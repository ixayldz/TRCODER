import fs from "fs";
import path from "path";
import { ensureDir, getArtifactsDir } from "./storage";

export interface ArtifactRecord {
  id: string;
  path: string;
  kind: string;
  created_at: string;
}

export function writeArtifact(runId: string, filename: string, content: string): ArtifactRecord {
  const runDir = path.join(getArtifactsDir(), `run-${runId}`);
  ensureDir(runDir);
  const filePath = path.join(runDir, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return {
    id: `${runId}:${filename}`,
    path: filePath,
    kind: filename,
    created_at: new Date().toISOString()
  };
}

export function writePlanArtifact(planId: string, filename: string, content: string): ArtifactRecord {
  const planDir = path.join(getArtifactsDir(), `plan-${planId}`);
  ensureDir(planDir);
  const filePath = path.join(planDir, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return {
    id: `${planId}:${filename}`,
    path: filePath,
    kind: filename,
    created_at: new Date().toISOString()
  };
}
