/**
 * Billing Types
 */

export interface Plan {
    id: string;
    name: string;
    description: string;
    price_monthly_usd: number;
    price_yearly_usd: number;
    credits_monthly: number;
    features: string[];
    limits: {
        max_projects: number;
        max_concurrent_runs: number;
        max_context_size: number;
        support_level: "community" | "email" | "priority" | "dedicated";
    };
    stripe_price_id_monthly?: string;
    stripe_price_id_yearly?: string;
    is_public: boolean;
    sort_order: number;
}

export interface Subscription {
    id: string;
    org_id: string;
    plan_id: string;
    status: "active" | "past_due" | "canceled" | "trialing" | "incomplete";
    billing_cycle: "monthly" | "yearly";
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
    stripe_subscription_id?: string;
    stripe_customer_id?: string;
    created_at: string;
    updated_at: string;
}

export interface Invoice {
    id: string;
    org_id: string;
    subscription_id?: string;
    amount_usd: number;
    credits_purchased?: number;
    status: "draft" | "open" | "paid" | "void" | "uncollectible";
    stripe_invoice_id?: string;
    stripe_payment_intent_id?: string;
    pdf_url?: string;
    period_start: string;
    period_end: string;
    due_date?: string;
    paid_at?: string;
    created_at: string;
}

export interface UsageSummary {
    org_id: string;
    period_start: string;
    period_end: string;
    credits_used: number;
    credits_included: number;
    credits_purchased: number;
    overage_cost_usd: number;
    total_runs: number;
    total_tasks: number;
    top_models: Array<{ model: string; credits: number; runs: number }>;
}

export interface CreditTransaction {
    id: string;
    org_id: string;
    type: "allocation" | "usage" | "purchase" | "bonus" | "refund";
    amount: number;  // positive = add, negative = subtract
    balance_after: number;
    description: string;
    run_id?: string;
    invoice_id?: string;
    created_at: string;
}

export interface CheckoutSession {
    id: string;
    url: string;
    expires_at: string;
}

export interface CustomerPortalSession {
    url: string;
}
