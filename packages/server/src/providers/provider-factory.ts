/**
 * Provider Factory - Creates and manages LLM provider instances with fallback support
 */

import { IModelProvider, getProviderForModel, ProviderError } from "./provider.interface";
import { OpenAIProvider } from "./openai-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { GoogleProvider } from "./google-provider";
import { MockModelProvider } from "../mock-provider";

export interface ProviderFactoryConfig {
    preferredProvider?: string;
    fallbackChains?: Record<string, string[]>;
    useMock?: boolean;
}

type ProviderInstance = {
    provider: IModelProvider;
    available: boolean;
    lastCheck: number;
};

const PROVIDER_CHECK_INTERVAL = 60000; // 1 minute

export class ProviderFactory {
    private providers: Map<string, ProviderInstance> = new Map();
    private fallbackChains: Record<string, string[]>;
    private useMock: boolean;
    private mockProvider?: IModelProvider;

    constructor(config: ProviderFactoryConfig = {}) {
        this.fallbackChains = config.fallbackChains ?? {};
        this.useMock = config.useMock ?? false;
        this.initializeProviders();
    }

    private initializeProviders(): void {
        if (this.useMock) {
            this.mockProvider = new MockModelProvider();
            return;
        }

        // Initialize OpenAI if API key is available
        if (process.env.OPENAI_API_KEY) {
            try {
                const provider = OpenAIProvider.fromEnv();
                this.providers.set("openai", {
                    provider,
                    available: true,
                    lastCheck: Date.now()
                });
            } catch (error) {
                console.warn("Failed to initialize OpenAI provider:", error);
            }
        }

        // Initialize Anthropic if API key is available
        if (process.env.ANTHROPIC_API_KEY) {
            try {
                const provider = AnthropicProvider.fromEnv();
                this.providers.set("anthropic", {
                    provider,
                    available: true,
                    lastCheck: Date.now()
                });
            } catch (error) {
                console.warn("Failed to initialize Anthropic provider:", error);
            }
        }

        // Initialize Google (Gemini) if API key is available
        if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
            try {
                const provider = GoogleProvider.fromEnv();
                this.providers.set("google", {
                    provider,
                    available: true,
                    lastCheck: Date.now()
                });
            } catch (error) {
                console.warn("Failed to initialize Google provider:", error);
            }
        }

        // Always have mock provider as ultimate fallback
        if (this.useMock || this.providers.size === 0) {
            this.mockProvider = new MockModelProvider();
        }
    }

    getProvider(providerName: string): IModelProvider | null {
        const instance = this.providers.get(providerName);
        if (!instance) return null;

        // Check if we need to re-verify availability
        if (Date.now() - instance.lastCheck > PROVIDER_CHECK_INTERVAL && !instance.available) {
            this.checkProviderHealth(providerName);
        }

        return instance.available ? instance.provider : null;
    }

    getProviderForModel(model: string): IModelProvider | null {
        const providerName = getProviderForModel(model);
        if (!providerName) return null;
        return this.getProvider(providerName);
    }

    async getProviderWithFallback(model: string): Promise<{
        provider: IModelProvider;
        selectedModel: string;
        usedFallback: boolean;
    }> {
        const primaryProvider = this.getProviderForModel(model);

        if (primaryProvider) {
            return {
                provider: primaryProvider,
                selectedModel: model,
                usedFallback: false
            };
        }

        // Try fallback chain
        const fallbackChain = this.fallbackChains[model] ?? [];
        for (const fallbackModel of fallbackChain) {
            const fallbackProvider = this.getProviderForModel(fallbackModel);
            if (fallbackProvider) {
                return {
                    provider: fallbackProvider,
                    selectedModel: fallbackModel,
                    usedFallback: true
                };
            }
        }

        // Use mock provider as ultimate fallback
        if (this.mockProvider) {
            return {
                provider: this.mockProvider,
                selectedModel: "mock",
                usedFallback: true
            };
        }

        throw new ProviderError(
            `No available provider for model: ${model}`,
            "factory",
            503,
            false
        );
    }

    private async checkProviderHealth(providerName: string): Promise<void> {
        const instance = this.providers.get(providerName);
        if (!instance) return;

        try {
            const health = await instance.provider.healthCheck();
            instance.available = health.healthy;
            instance.lastCheck = Date.now();
        } catch {
            instance.available = false;
            instance.lastCheck = Date.now();
        }
    }

    async checkAllProvidersHealth(): Promise<Record<string, { available: boolean; latencyMs?: number }>> {
        const results: Record<string, { available: boolean; latencyMs?: number }> = {};

        for (const [name, instance] of this.providers) {
            try {
                const health = await instance.provider.healthCheck();
                instance.available = health.healthy;
                instance.lastCheck = Date.now();
                results[name] = { available: health.healthy, latencyMs: health.latencyMs };
            } catch {
                instance.available = false;
                instance.lastCheck = Date.now();
                results[name] = { available: false };
            }
        }

        if (this.mockProvider) {
            results["mock"] = { available: true, latencyMs: 0 };
        }

        return results;
    }

    getAvailableProviders(): string[] {
        const available: string[] = [];
        for (const [name, instance] of this.providers) {
            if (instance.available) {
                available.push(name);
            }
        }
        if (this.mockProvider) {
            available.push("mock");
        }
        return available;
    }

    setFallbackChains(chains: Record<string, string[]>): void {
        this.fallbackChains = chains;
    }
}

// Singleton instance
let factoryInstance: ProviderFactory | null = null;

export function getProviderFactory(config?: ProviderFactoryConfig): ProviderFactory {
    if (!factoryInstance) {
        factoryInstance = new ProviderFactory(config);
    }
    return factoryInstance;
}

export function resetProviderFactory(): void {
    factoryInstance = null;
}
