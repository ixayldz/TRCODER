/**
 * Plan Definitions
 */

import { Plan } from "./types";

export const PLANS: Record<string, Plan> = {
    free: {
        id: "free",
        name: "Free",
        description: "Perfect for trying out TRCODER",
        price_monthly_usd: 0,
        price_yearly_usd: 0,
        credits_monthly: 100,
        features: [
            "100 credits/month",
            "1 project",
            "Community support",
            "Basic models"
        ],
        limits: {
            max_projects: 1,
            max_concurrent_runs: 1,
            max_context_size: 50000,
            support_level: "community"
        },
        is_public: true,
        sort_order: 0
    },

    pro_monthly: {
        id: "pro_monthly",
        name: "Pro",
        description: "For individual developers and small teams",
        price_monthly_usd: 29,
        price_yearly_usd: 290,
        credits_monthly: 1000,
        features: [
            "1,000 credits/month",
            "10 projects",
            "Email support",
            "All models",
            "Priority queue"
        ],
        limits: {
            max_projects: 10,
            max_concurrent_runs: 3,
            max_context_size: 100000,
            support_level: "email"
        },
        stripe_price_id_monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
        stripe_price_id_yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
        is_public: true,
        sort_order: 1
    },

    team_monthly: {
        id: "team_monthly",
        name: "Team",
        description: "For growing teams that need more power",
        price_monthly_usd: 99,
        price_yearly_usd: 990,
        credits_monthly: 5000,
        features: [
            "5,000 credits/month",
            "Unlimited projects",
            "Priority support",
            "All models",
            "Team collaboration",
            "Usage analytics"
        ],
        limits: {
            max_projects: -1, // unlimited
            max_concurrent_runs: 10,
            max_context_size: 200000,
            support_level: "priority"
        },
        stripe_price_id_monthly: process.env.STRIPE_TEAM_MONTHLY_PRICE_ID,
        stripe_price_id_yearly: process.env.STRIPE_TEAM_YEARLY_PRICE_ID,
        is_public: true,
        sort_order: 2
    },

    enterprise: {
        id: "enterprise",
        name: "Enterprise",
        description: "Custom solutions for large organizations",
        price_monthly_usd: -1, // custom pricing
        price_yearly_usd: -1,
        credits_monthly: -1, // custom
        features: [
            "Custom credit allocation",
            "Unlimited projects",
            "Dedicated support",
            "SSO/SAML",
            "On-premise option",
            "SLA guarantee",
            "Custom integrations"
        ],
        limits: {
            max_projects: -1,
            max_concurrent_runs: -1,
            max_context_size: -1,
            support_level: "dedicated"
        },
        is_public: true,
        sort_order: 3
    }
};

export function getPlan(planId: string): Plan | null {
    // Normalize plan IDs
    const normalizedId = planId.replace("_yearly", "_monthly");
    return PLANS[normalizedId] ?? PLANS[planId] ?? null;
}

export function getPublicPlans(): Plan[] {
    return Object.values(PLANS)
        .filter(p => p.is_public)
        .sort((a, b) => a.sort_order - b.sort_order);
}

export function canUpgrade(currentPlanId: string, targetPlanId: string): boolean {
    const current = getPlan(currentPlanId);
    const target = getPlan(targetPlanId);
    if (!current || !target) return false;
    return target.sort_order > current.sort_order;
}

export function canDowngrade(currentPlanId: string, targetPlanId: string): boolean {
    const current = getPlan(currentPlanId);
    const target = getPlan(targetPlanId);
    if (!current || !target) return false;
    return target.sort_order < current.sort_order;
}

// Credit pricing for pay-as-you-go
export const CREDIT_PRICING = {
    credits_per_dollar: 100,  // $1 = 100 credits
    minimum_purchase: 500,    // Minimum 500 credits ($5)
    bulk_discounts: [
        { credits: 10000, discount: 0.10 },  // 10% off for 10k+
        { credits: 50000, discount: 0.20 },  // 20% off for 50k+
        { credits: 100000, discount: 0.30 }  // 30% off for 100k+
    ]
};

export function calculateCreditPrice(credits: number): number {
    let price = credits / CREDIT_PRICING.credits_per_dollar;

    for (const tier of CREDIT_PRICING.bulk_discounts) {
        if (credits >= tier.credits) {
            price = price * (1 - tier.discount);
        }
    }

    return Math.round(price * 100) / 100; // Round to cents
}
