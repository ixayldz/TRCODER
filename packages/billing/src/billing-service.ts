/**
 * Billing Service
 */

import { Subscription, Invoice, UsageSummary, CreditTransaction } from "./types";
import { getPlan } from "./plans";
import { StripeService } from "./stripe";

export interface BillingStore {
    // Subscriptions
    getSubscription(orgId: string): Promise<Subscription | null>;
    createSubscription(sub: Omit<Subscription, "id" | "created_at" | "updated_at">): Promise<Subscription>;
    updateSubscription(id: string, data: Partial<Subscription>): Promise<Subscription>;

    // Invoices
    getInvoices(orgId: string, limit?: number): Promise<Invoice[]>;
    createInvoice(invoice: Omit<Invoice, "id" | "created_at">): Promise<Invoice>;
    updateInvoice(id: string, data: Partial<Invoice>): Promise<Invoice>;

    // Credits
    getCreditsBalance(orgId: string): Promise<number>;
    updateCreditsBalance(orgId: string, balance: number): Promise<void>;
    addCreditTransaction(tx: Omit<CreditTransaction, "id" | "created_at">): Promise<CreditTransaction>;
    getCreditTransactions(orgId: string, limit?: number): Promise<CreditTransaction[]>;

    // Usage
    getUsageSummary(orgId: string, periodStart: Date, periodEnd: Date): Promise<UsageSummary>;
}

export interface BillingServiceConfig {
    store: BillingStore;
    stripe: StripeService;
}

export class BillingService {
    private store: BillingStore;
    private stripe: StripeService;

    constructor(config: BillingServiceConfig) {
        this.store = config.store;
        this.stripe = config.stripe;
    }

    /**
     * Get current subscription
     */
    async getSubscription(orgId: string): Promise<Subscription | null> {
        return this.store.getSubscription(orgId);
    }

    /**
     * Create checkout for subscription upgrade
     */
    async createSubscriptionCheckout(orgId: string, params: {
        planId: string;
        billing_cycle: "monthly" | "yearly";
        customerId: string;
    }) {
        const currentSub = await this.store.getSubscription(orgId);
        if (currentSub?.status === "active" && !currentSub.cancel_at_period_end) {
            // Already has active subscription - redirect to portal
            return await this.stripe.createPortalSession(params.customerId);
        }

        return await this.stripe.createSubscriptionCheckout({
            customerId: params.customerId,
            planId: params.planId,
            billing_cycle: params.billing_cycle
        });
    }

    /**
     * Create checkout for credit purchase
     */
    async createCreditPurchase(orgId: string, credits: number, customerId: string) {
        return await this.stripe.createCreditPurchaseCheckout({
            customerId,
            credits,
            orgId
        });
    }

    /**
     * Get customer portal URL
     */
    async getCustomerPortal(customerId: string) {
        return await this.stripe.createPortalSession(customerId);
    }

    /**
     * Use credits for a run
     * NOTE: This should be wrapped in a database transaction with SELECT FOR UPDATE
     * to prevent race conditions in concurrent requests
     */
    async useCredits(orgId: string, amount: number, runId: string): Promise<{
        success: boolean;
        remaining: number;
        error?: string;
    }> {
        // Input validation
        if (!Number.isFinite(amount) || amount <= 0) {
            return {
                success: false,
                remaining: 0,
                error: "Invalid credit amount"
            };
        }

        if (amount > 1_000_000) {
            return {
                success: false,
                remaining: 0,
                error: "Amount exceeds maximum limit"
            };
        }

        const balance = await this.store.getCreditsBalance(orgId);

        if (balance < amount) {
            return {
                success: false,
                remaining: balance,
                error: "Insufficient credits"
            };
        }

        const newBalance = balance - amount;
        await this.store.updateCreditsBalance(orgId, newBalance);

        await this.store.addCreditTransaction({
            org_id: orgId,
            type: "usage",
            amount: -amount,
            balance_after: newBalance,
            description: `Run ${runId}`,
            run_id: runId
        });

        return {
            success: true,
            remaining: newBalance
        };
    }

    /**
     * Add credits (from purchase or monthly allocation)
     */
    async addCredits(orgId: string, amount: number, params: {
        type: "allocation" | "purchase" | "bonus" | "refund";
        description: string;
        invoiceId?: string;
    }): Promise<number> {
        const balance = await this.store.getCreditsBalance(orgId);
        const newBalance = balance + amount;

        await this.store.updateCreditsBalance(orgId, newBalance);

        await this.store.addCreditTransaction({
            org_id: orgId,
            type: params.type,
            amount,
            balance_after: newBalance,
            description: params.description,
            invoice_id: params.invoiceId
        });

        return newBalance;
    }

    /**
     * Get usage summary for billing period
     */
    async getUsageSummary(orgId: string, period?: { start: Date; end: Date }): Promise<UsageSummary> {
        const now = new Date();
        const periodStart = period?.start ?? new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = period?.end ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);

        return this.store.getUsageSummary(orgId, periodStart, periodEnd);
    }

    /**
     * Get recent invoices
     */
    async getInvoices(orgId: string, limit = 12): Promise<Invoice[]> {
        return this.store.getInvoices(orgId, limit);
    }

    /**
     * Get credit transactions
     */
    async getCreditTransactions(orgId: string, limit = 50): Promise<CreditTransaction[]> {
        return this.store.getCreditTransactions(orgId, limit);
    }

    /**
     * Cancel subscription at period end
     */
    async cancelSubscription(orgId: string): Promise<void> {
        const sub = await this.store.getSubscription(orgId);
        if (!sub?.stripe_subscription_id) {
            throw new Error("No active subscription found");
        }

        await this.stripe.cancelSubscription(sub.stripe_subscription_id);
        await this.store.updateSubscription(sub.id, {
            cancel_at_period_end: true
        });
    }

    /**
     * Reactivate canceled subscription
     */
    async reactivateSubscription(orgId: string): Promise<void> {
        const sub = await this.store.getSubscription(orgId);
        if (!sub?.stripe_subscription_id) {
            throw new Error("No subscription found");
        }

        await this.stripe.reactivateSubscription(sub.stripe_subscription_id);
        await this.store.updateSubscription(sub.id, {
            cancel_at_period_end: false
        });
    }

    /**
     * Monthly credit reset (called by cron job)
     */
    async processMonthlyCredits(orgId: string): Promise<void> {
        const sub = await this.store.getSubscription(orgId);
        if (!sub || sub.status !== "active") return;

        const plan = getPlan(sub.plan_id);
        if (!plan) return;

        await this.addCredits(orgId, plan.credits_monthly, {
            type: "allocation",
            description: `Monthly allocation - ${plan.name} plan`
        });
    }
}
