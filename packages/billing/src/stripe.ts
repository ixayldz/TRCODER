/**
 * Stripe Integration
 */

import Stripe from "stripe";
import { CheckoutSession, CustomerPortalSession, Subscription, Invoice } from "./types";
import { getPlan, calculateCreditPrice, CREDIT_PRICING } from "./plans";

export interface StripeConfig {
    secretKey: string;
    webhookSecret?: string;
    successUrl: string;
    cancelUrl: string;
}

export class StripeService {
    private stripe: Stripe;
    private config: StripeConfig;

    constructor(config: StripeConfig) {
        this.config = config;
        this.stripe = new Stripe(config.secretKey, {
            apiVersion: "2023-10-16"
        });
    }

    static fromEnv(): StripeService {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (!secretKey) {
            throw new Error("STRIPE_SECRET_KEY environment variable is required");
        }
        return new StripeService({
            secretKey,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            successUrl: process.env.STRIPE_SUCCESS_URL ?? "https://trcoder.io/billing/success",
            cancelUrl: process.env.STRIPE_CANCEL_URL ?? "https://trcoder.io/billing/cancel"
        });
    }

    /**
     * Create or get Stripe customer
     */
    async getOrCreateCustomer(data: {
        orgId: string;
        email: string;
        name?: string;
        existingCustomerId?: string;
    }): Promise<string> {
        if (data.existingCustomerId) {
            return data.existingCustomerId;
        }

        const customer = await this.stripe.customers.create({
            email: data.email,
            name: data.name,
            metadata: { org_id: data.orgId }
        });

        return customer.id;
    }

    /**
     * Create checkout session for subscription
     */
    async createSubscriptionCheckout(params: {
        customerId: string;
        planId: string;
        billing_cycle: "monthly" | "yearly";
    }): Promise<CheckoutSession> {
        const plan = getPlan(params.planId);
        if (!plan) {
            throw new Error(`Plan not found: ${params.planId}`);
        }

        const priceId = params.billing_cycle === "yearly"
            ? plan.stripe_price_id_yearly
            : plan.stripe_price_id_monthly;

        if (!priceId) {
            throw new Error(`No Stripe price configured for plan: ${params.planId}`);
        }

        const session = await this.stripe.checkout.sessions.create({
            customer: params.customerId,
            mode: "subscription",
            line_items: [{
                price: priceId,
                quantity: 1
            }],
            success_url: `${this.config.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: this.config.cancelUrl,
            subscription_data: {
                metadata: { plan_id: params.planId }
            }
        });

        if (!session.url) {
            throw new Error("Stripe checkout session URL not available");
        }

        return {
            id: session.id,
            url: session.url,
            expires_at: new Date(session.expires_at * 1000).toISOString()
        };
    }

    /**
     * Create checkout session for credit purchase
     */
    async createCreditPurchaseCheckout(params: {
        customerId: string;
        credits: number;
        orgId: string;
    }): Promise<CheckoutSession> {
        if (params.credits < CREDIT_PRICING.minimum_purchase) {
            throw new Error(`Minimum purchase is ${CREDIT_PRICING.minimum_purchase} credits`);
        }

        const priceInCents = Math.round(calculateCreditPrice(params.credits) * 100);

        const session = await this.stripe.checkout.sessions.create({
            customer: params.customerId,
            mode: "payment",
            line_items: [{
                price_data: {
                    currency: "usd",
                    product_data: {
                        name: `${params.credits} TRCODER Credits`,
                        description: "Pay-as-you-go credits for TRCODER"
                    },
                    unit_amount: priceInCents
                },
                quantity: 1
            }],
            success_url: `${this.config.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: this.config.cancelUrl,
            metadata: {
                type: "credit_purchase",
                org_id: params.orgId,
                credits: params.credits.toString()
            }
        });

        if (!session.url) {
            throw new Error("Stripe checkout session URL not available");
        }

        return {
            id: session.id,
            url: session.url,
            expires_at: new Date(session.expires_at * 1000).toISOString()
        };
    }

    /**
     * Create customer portal session
     */
    async createPortalSession(customerId: string): Promise<CustomerPortalSession> {
        const session = await this.stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: this.config.successUrl
        });

        return { url: session.url };
    }

    /**
     * Get subscription details
     */
    async getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
        try {
            return await this.stripe.subscriptions.retrieve(subscriptionId);
        } catch (err: unknown) {
            // Log error internally but don't expose details
            console.error("Failed to retrieve subscription:", err);
            return null;
        }
    }

    /**
     * Cancel subscription at period end
     */
    async cancelSubscription(subscriptionId: string): Promise<void> {
        await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true
        });
    }

    /**
     * Reactivate canceled subscription
     */
    async reactivateSubscription(subscriptionId: string): Promise<void> {
        await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: false
        });
    }

    /**
     * Change subscription plan
     */
    async changeSubscriptionPlan(params: {
        subscriptionId: string;
        newPlanId: string;
        billing_cycle: "monthly" | "yearly";
    }): Promise<void> {
        const plan = getPlan(params.newPlanId);
        if (!plan) {
            throw new Error(`Plan not found: ${params.newPlanId}`);
        }

        const priceId = params.billing_cycle === "yearly"
            ? plan.stripe_price_id_yearly
            : plan.stripe_price_id_monthly;

        if (!priceId) {
            throw new Error(`No Stripe price configured for plan: ${params.newPlanId}`);
        }

        const subscription = await this.stripe.subscriptions.retrieve(params.subscriptionId);

        await this.stripe.subscriptions.update(params.subscriptionId, {
            items: [{
                id: subscription.items.data[0].id,
                price: priceId
            }],
            metadata: { plan_id: params.newPlanId }
        });
    }

    /**
     * Verify webhook signature
     */
    verifyWebhook(payload: string | Buffer, signature: string): Stripe.Event {
        if (!this.config.webhookSecret) {
            throw new Error("Webhook secret not configured");
        }
        return this.stripe.webhooks.constructEvent(
            payload,
            signature,
            this.config.webhookSecret
        );
    }

    /**
     * Get Stripe instance for advanced usage
     */
    getStripe(): Stripe {
        return this.stripe;
    }
}
