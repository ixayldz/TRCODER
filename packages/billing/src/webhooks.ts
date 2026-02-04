/**
 * Stripe Webhook Handler
 */

import Stripe from "stripe";
import { StripeService } from "./stripe";
import { BillingService } from "./billing-service";
import { getPlan } from "./plans";

export interface WebhookHandlerConfig {
    stripeService: StripeService;
    billingService: BillingService;
    onSubscriptionCreated?: (orgId: string, planId: string) => Promise<void>;
    onSubscriptionCanceled?: (orgId: string) => Promise<void>;
    onCreditsPurchased?: (orgId: string, credits: number) => Promise<void>;
    onPaymentFailed?: (orgId: string, error: string) => Promise<void>;
}

export class WebhookHandler {
    private config: WebhookHandlerConfig;

    constructor(config: WebhookHandlerConfig) {
        this.config = config;
    }

    async handleWebhook(payload: string | Buffer, signature: string): Promise<{
        handled: boolean;
        event_type: string;
        error?: string;
    }> {
        let event: Stripe.Event;

        try {
            event = this.config.stripeService.verifyWebhook(payload, signature);
        } catch (err: unknown) {
            // Log detailed error internally but don't expose to response
            console.error("Webhook verification failed:", err);
            return {
                handled: false,
                event_type: "unknown",
                error: "Webhook verification failed"
            };
        }

        try {
            await this.processEvent(event);
            return {
                handled: true,
                event_type: event.type
            };
        } catch (err: unknown) {
            // Log detailed error internally
            console.error("Event processing failed:", { eventType: event.type, error: err });
            return {
                handled: false,
                event_type: event.type,
                error: "Event processing failed"
            };
        }
    }

    private async processEvent(event: Stripe.Event): Promise<void> {
        switch (event.type) {
            case "checkout.session.completed":
                await this.handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
                break;

            case "customer.subscription.created":
            case "customer.subscription.updated":
                await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
                break;

            case "customer.subscription.deleted":
                await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;

            case "invoice.paid":
                await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
                break;

            case "invoice.payment_failed":
                await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
                break;

            default:
                console.log(`Unhandled webhook event: ${event.type}`);
        }
    }

    private async handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
        const metadata = session.metadata ?? {};

        if (metadata.type === "credit_purchase") {
            // Credit purchase completed
            const orgId = metadata.org_id;
            const creditsStr = metadata.credits;

            // Validate credits value
            if (!creditsStr || !/^\d+$/.test(creditsStr)) {
                console.error("Invalid credits value in checkout metadata:", { orgId, creditsStr });
                return;
            }

            const credits = parseInt(creditsStr, 10);
            if (!Number.isFinite(credits) || credits <= 0) {
                console.error("Credits value out of valid range:", { orgId, credits });
                return;
            }

            if (orgId && credits) {
                await this.config.billingService.addCredits(orgId, credits, {
                    type: "purchase",
                    description: `Purchased ${credits} credits`
                });

                if (this.config.onCreditsPurchased) {
                    await this.config.onCreditsPurchased(orgId, credits);
                }
            }
        }
    }

    private async handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
        const customerId = subscription.customer as string;
        const planId = subscription.metadata?.plan_id;

        if (!planId) return;

        // Get org from customer metadata
        const stripe = this.config.stripeService.getStripe();
        const customer = await stripe.customers.retrieve(customerId);

        if (customer.deleted) return;

        const orgId = customer.metadata?.org_id;
        if (!orgId) return;

        // Update subscription in database
        // This would typically call a store method

        // Allocate credits for new subscription
        if (subscription.status === "active") {
            const plan = getPlan(planId);
            if (plan) {
                await this.config.billingService.addCredits(orgId, plan.credits_monthly, {
                    type: "allocation",
                    description: `Subscription activated - ${plan.name} plan`
                });
            }

            if (this.config.onSubscriptionCreated) {
                await this.config.onSubscriptionCreated(orgId, planId);
            }
        }
    }

    private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
        const customerId = subscription.customer as string;

        const stripe = this.config.stripeService.getStripe();
        const customer = await stripe.customers.retrieve(customerId);

        if (customer.deleted) return;

        const orgId = customer.metadata?.org_id;
        if (!orgId) return;

        // Downgrade to free plan
        if (this.config.onSubscriptionCanceled) {
            await this.config.onSubscriptionCanceled(orgId);
        }
    }

    private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
        // Invoice paid - could trigger additional actions
        console.log(`Invoice paid: ${invoice.id}`);
    }

    private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
        const customerId = invoice.customer as string;

        const stripe = this.config.stripeService.getStripe();
        const customer = await stripe.customers.retrieve(customerId);

        if (customer.deleted) return;

        const orgId = customer.metadata?.org_id;
        if (!orgId) return;

        if (this.config.onPaymentFailed) {
            await this.config.onPaymentFailed(orgId, "Payment failed");
        }
    }
}
