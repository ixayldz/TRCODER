import { PricingConfig } from "@trcoder/shared";
import { IDb } from "./db";
import { listLedgerEvents } from "./ledger-store";

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function startOfNextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
}

export function computeUsageForRange(input: {
  db: IDb;
  pricing: PricingConfig;
  plan_id: string;
  start: Date;
  end: Date;
}) {
  const start = input.start.toISOString();
  const end = input.end.toISOString();

  const events = listLedgerEvents(input.db, start, end).filter(
    (event) => event.event_type === "LLM_CALL_FINISHED"
  );

  let provider_cost_total = 0;
  let charged_total = 0;
  let credits_used = 0;
  let billable_provider_cost_total = 0;
  const drivers = new Map<string, { provider: number; charge: number }>();

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const provider_cost = Number(payload.provider_cost_usd ?? 0);
    const charge = Number(payload.our_charge_usd ?? 0);
    const credits_applied = Number(payload.credits_applied_usd ?? 0);
    const billable = Number(payload.billable_provider_cost_usd ?? 0);
    const model = String(payload.model ?? "unknown");
    const task_type = String(payload.task_type ?? "unknown");
    const key = `${model}::${task_type}`;

    provider_cost_total += provider_cost;
    charged_total += charge;
    credits_used += credits_applied;
    billable_provider_cost_total += billable;

    const existing = drivers.get(key) ?? { provider: 0, charge: 0 };
    existing.provider += provider_cost;
    existing.charge += charge;
    drivers.set(key, existing);
  }

  const plan = input.pricing.plans[input.plan_id];
  const credits_included = plan?.included_credits_trc ?? 0;
  const payg_overage = billable_provider_cost_total;
  const effective_markup =
    billable_provider_cost_total > 0 ? charged_total / billable_provider_cost_total - 1 : 0;

  const top_cost_drivers = Array.from(drivers.entries())
    .map(([key, totals]) => {
      const [model, task_type] = key.split("::");
      return { model, task_type, provider_cost: totals.provider, charge: totals.charge };
    })
    .sort((a, b) => b.provider_cost - a.provider_cost)
    .slice(0, 5);

  return {
    provider_cost_total,
    charged_total,
    credits_used,
    credits_included,
    billable_provider_cost_total,
    payg_overage,
    top_cost_drivers,
    effective_markup
  };
}

export function computeUsageForMonth(input: {
  db: IDb;
  pricing: PricingConfig;
  plan_id: string;
  month?: Date;
}) {
  const monthDate = input.month ?? new Date();
  const start = startOfMonth(monthDate);
  const end = startOfNextMonth(monthDate);
  const usage = computeUsageForRange({ ...input, start, end });

  return {
    month: monthDate.toISOString().slice(0, 7),
    ...usage
  };
}

export function computeInvoicePreview(input: {
  db: IDb;
  pricing: PricingConfig;
  plan_id: string;
  month?: Date;
}) {
  const usage = computeUsageForMonth(input);
  const plan = input.pricing.plans[input.plan_id];
  const monthly_price = plan?.monthly_price_usd ?? 0;
  const minimum_monthly = input.pricing.payg_only.minimum_monthly_charge_usd ?? 0;
  const subtotal = monthly_price + usage.charged_total;
  const total = Math.max(subtotal, minimum_monthly);

  return {
    plan_id: input.plan_id,
    month: usage.month,
    monthly_price_usd: monthly_price,
    usage,
    subtotal_usd: subtotal,
    minimum_monthly_charge_usd: minimum_monthly,
    total_usd: total
  };
}
