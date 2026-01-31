import { ContextPackManifest, ContextPackFileEntry, ContextBudget } from "@trcoder/shared";

export function buildContextPack(input: {
  runId: string;
  taskId: string;
  budgets: ContextBudget;
  pins: string[];
  summary?: string;
  signals?: ContextPackManifest["signals"];
}): ContextPackManifest {
  const pack_id = `ctx_${input.runId}_${input.taskId}_${Date.now()}`;
  const mode: ContextPackManifest["mode"] = input.budgets.hydrate ? "hydrated" : "manifest";
  const file_entries: ContextPackFileEntry[] = input.pins.map((path) => ({
    path,
    why: "pinned"
  }));

  const signals = {
    ...(input.signals ?? {}),
    diff_summary: input.summary ?? input.signals?.diff_summary
  };

  return {
    pack_id,
    task_id: input.taskId,
    run_id: input.runId,
    mode,
    pinned_sources: input.pins,
    file_entries,
    signals,
    budgets: input.budgets,
    redaction_stats: { masked_entries: 0, masked_chars: 0 }
  };
}
