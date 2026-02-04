import { ContextPackManifest } from "@trcoder/shared";
import { IDb } from "./db";
import { parseJsonValue } from "./utils/json";

export async function saveContextPack(
  db: IDb,
  input: { project_id: string; manifest: ContextPackManifest }
): Promise<void> {
  await db.exec(
    "INSERT INTO context_packs (pack_id, project_id, run_id, task_id, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      input.manifest.pack_id,
      input.project_id,
      input.manifest.run_id,
      input.manifest.task_id,
      JSON.stringify(input.manifest),
      new Date().toISOString()
    ]
  );
}

export async function getContextPack(db: IDb, packId: string): Promise<ContextPackManifest | null> {
  const record = await getContextPackRecord(db, packId);
  return record?.manifest ?? null;
}

export async function getContextPackRecord(
  db: IDb,
  packId: string
): Promise<{ project_id: string; manifest: ContextPackManifest; created_at: string } | null> {
  const row = (await db.query<{ project_id?: string; manifest_json?: unknown; created_at?: string }>(
    "SELECT project_id, manifest_json, created_at FROM context_packs WHERE pack_id = ?",
    [packId]
  ))[0];
  if (!row?.manifest_json || !row?.project_id || !row.created_at) return null;
  return {
    project_id: row.project_id,
    manifest: parseJsonValue<ContextPackManifest>(row.manifest_json, {} as ContextPackManifest),
    created_at: row.created_at
  };
}

export async function updateContextPack(db: IDb, manifest: ContextPackManifest): Promise<void> {
  await db.exec("UPDATE context_packs SET manifest_json = ? WHERE pack_id = ?", [
    JSON.stringify(manifest),
    manifest.pack_id
  ]);
}
