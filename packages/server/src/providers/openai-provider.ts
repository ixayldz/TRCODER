/**
 * OpenAI Provider Implementation
 */

import {
    IModelProvider,
    ChatCompletionRequest,
    ChatCompletionResponse,
    StreamChunk,
    ProviderConfig,
    ProviderHealth,
    ProviderError,
    RateLimitError,
    AuthenticationError,
    ModelNotFoundError
} from "./provider.interface";
import { withRetry, CircuitBreaker, RateLimiter } from "./retry";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 2;

interface OpenAIConfig extends ProviderConfig {
    requestsPerMinute?: number;
}

export class OpenAIProvider implements IModelProvider {
    readonly name = "openai";
    readonly models = ["gpt-5.2-xhigh", "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"];

    private config: OpenAIConfig;
    private circuitBreaker: CircuitBreaker;
    private rateLimiter: RateLimiter;
    private lastError?: string;
    private lastErrorTime?: Date;

    constructor(config: OpenAIConfig) {
        this.config = {
            baseUrl: DEFAULT_BASE_URL,
            timeout: DEFAULT_TIMEOUT,
            maxRetries: DEFAULT_MAX_RETRIES,
            ...config
        };
        this.circuitBreaker = new CircuitBreaker("openai");
        this.rateLimiter = new RateLimiter(config.requestsPerMinute ?? 60);
    }

    static fromEnv(): OpenAIProvider {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY environment variable is required");
        }
        return new OpenAIProvider({
            apiKey,
            organization: process.env.OPENAI_ORG_ID,
            baseUrl: process.env.OPENAI_BASE_URL,
            requestsPerMinute: parseInt(process.env.OPENAI_RPM ?? "60", 10)
        });
    }

    private async request<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
        await this.rateLimiter.acquire();

        const url = `${this.config.baseUrl}${endpoint}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`
        };

        if (this.config.organization) {
            headers["OpenAI-Organization"] = this.config.organization;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: controller.signal
            });

            if (!response.ok) {
                const errorBody = await response.text();
                this.handleError(response.status, errorBody);
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    private handleError(status: number, body: string): never {
        this.lastError = body;
        this.lastErrorTime = new Date();

        if (status === 429) {
            const match = body.match(/retry after (\d+)/i);
            const retryAfter = match ? parseInt(match[1], 10) * 1000 : undefined;
            throw new RateLimitError("openai", retryAfter);
        }

        if (status === 401) {
            throw new AuthenticationError("openai");
        }

        if (status === 404) {
            throw new ModelNotFoundError("openai", "unknown");
        }

        throw new ProviderError(
            `OpenAI API error: ${body}`,
            "openai",
            status,
            status >= 500
        );
    }

    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const model = this.mapModel(request.model ?? "gpt-4o");

        const fn = async () => {
            const response = await this.request<{
                id: string;
                model: string;
                choices: Array<{
                    message: { content: string };
                    finish_reason: string;
                }>;
                usage: {
                    prompt_tokens: number;
                    completion_tokens: number;
                    total_tokens: number;
                };
            }>("/chat/completions", {
                model,
                messages: request.messages,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.max_tokens ?? 4096,
                stop: request.stop
            });

            return {
                id: response.id,
                model: response.model,
                content: response.choices[0]?.message?.content ?? "",
                finish_reason: response.choices[0]?.finish_reason as ChatCompletionResponse["finish_reason"],
                usage: response.usage
            };
        };

        return this.circuitBreaker.execute(() =>
            withRetry(fn, { maxRetries: this.config.maxRetries }, (error) => {
                return error instanceof ProviderError && error.retryable;
            })
        );
    }

    async generatePatch(input: {
        task_id: string;
        instructions?: string;
        context?: string;
    }): Promise<{ patchText: string; summary: string; changedFiles: number; usage: ChatCompletionResponse["usage"] }> {
        const systemPrompt = `You are a code assistant that generates unified diff patches.
Output ONLY the patch in unified diff format, nothing else.
The patch should be minimal and focused on the requested changes.`;

        const userPrompt = `Task ID: ${input.task_id}
${input.instructions ? `Instructions: ${input.instructions}` : ""}
${input.context ? `Context:\n${input.context}` : ""}

Generate a patch to complete this task.`;

        const response = await this.chat({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 8192
        });

        const patchText = response.content;
        const changedFiles = (patchText.match(/^diff --git/gm) || []).length;
        const summary = `Generated patch with ${changedFiles} file(s) for task ${input.task_id}`;

        return {
            patchText,
            summary,
            changedFiles,
            usage: response.usage
        };
    }

    async healthCheck(): Promise<ProviderHealth> {
        const start = Date.now();
        try {
            await this.chat({
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1
            });
            return {
                healthy: true,
                latencyMs: Date.now() - start
            };
        } catch (error) {
            return {
                healthy: false,
                latencyMs: Date.now() - start,
                lastError: this.lastError,
                lastErrorTime: this.lastErrorTime
            };
        }
    }

    private mapModel(model: string): string {
        // Map internal model names to OpenAI API names
        const modelMap: Record<string, string> = {
            "gpt-5.2-xhigh": "gpt-4o", // Fallback to available model
            "gpt-4o": "gpt-4o",
            "gpt-4-turbo": "gpt-4-turbo",
            "gpt-4": "gpt-4",
            "gpt-3.5-turbo": "gpt-3.5-turbo"
        };
        return modelMap[model] ?? model;
    }
}
