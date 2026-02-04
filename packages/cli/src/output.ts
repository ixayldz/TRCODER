import { styleText } from "./theme";

export function formatRunBanner(data: any): string {
  return [
    styleText("=== RUN ===", "header"),
    `Plan: ${data.plan_type} (${data.plan_id ?? "n/a"}) | Lane: ${data.lane} | Risk: ${data.risk} | Gates: ${data.gates_mode}`,
    `Repo: ${data.repo} | Commit: ${data.commit}`,
    `Approved Plan: ${data.approved_plan_id}`
  ].join("\n");
}

export function formatTaskHeader(data: any): string {
  const budgets = data.context_pack?.budgets ?? {};
  const mode = data.context_pack?.mode ?? "manifest";
  return [
    styleText("--- TASK ---", "header"),
    `Task: ${data.task_id} - ${data.title} (${data.task_type})`,
    `Model: ${data.selected_model}`,
    `Context: ${data.context_pack?.id} (${mode}) | files ${budgets.max_files} lines ${budgets.max_lines} depth ${budgets.graph_depth} topk ${budgets.top_k}`,
    `Expected Cost: p50 $${data.expected_cost_range?.p50} / p90 $${data.expected_cost_range?.p90} | Budget Remaining: $${data.budget_remaining}`
  ].join("\n");
}

export function formatStage(data: any): string {
  const ts = new Date().toLocaleTimeString();
  return styleText(`[${ts}] ${data.stage}: ${data.message}`, "stage");
}

export function formatTaskResult(data: any): string {
  const tokenLine = data.tokens ? `Tokens: in ${data.tokens.input} | out ${data.tokens.output}` : "Tokens: n/a";
  const riskLine = data.risk_notes ? `Risk Notes: ${data.risk_notes.join(", ")}` : "Risk Notes: n/a";
  const rollbackLine = data.rollback_notes ? `Rollback Notes: ${data.rollback_notes.join(", ")}` : "Rollback Notes: n/a";
  return [
    styleText("--- RESULT ---", "header"),
    data.patch_path ? `Patch: ${data.patch_path}` : "Patch: n/a",
    data.changed_files !== undefined ? `Changed Files: ${data.changed_files}` : "Changed Files: n/a",
    `Verify: ${data.verify_status ?? "n/a"}`,
    data.cost ? `Cost: provider $${data.cost.provider} | charge $${data.cost.charge}` : "Cost: n/a",
    tokenLine,
    riskLine,
    rollbackLine
  ].join("\n");
}

export function formatAnomaly(data: any): string {
  return [
    styleText("!!! ANOMALY !!!", "header"),
    `Expected(p90): $${data.expected_p90} | Actual: $${data.actual}`,
    `Reason: ${data.reason}`,
    `Action: ${data.action}`,
    `Suggestions: ${(data.suggestions ?? []).join(", ")}`
  ].join("\n");
}

export function formatSessionStats(data: any): string {
  const elapsed = data.time_elapsed_sec ?? 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const usage = Array.isArray(data.model_usage)
    ? data.model_usage
        .map(
          (item: any) =>
            `${item.model} calls=${item.calls} provider=$${item.provider_cost_usd} charged=$${item.charged_usd}`
        )
        .join(" | ")
    : "n/a";
  return [
    styleText("=== SESSION STATS ===", "header"),
    `Elapsed: ${mins}m ${secs}s | Tasks: ${data.tasks_completed}/${data.tasks_total}`,
    `Cost: $${data.cost_to_date_usd} | Remaining: $${data.budget_remaining_usd}`,
    `Model usage: ${usage}`
  ].join("\n");
}
