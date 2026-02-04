/**
 * Anthropic Provider Implementation
 */

import {
    IModelProvider,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ProviderConfig,
    ProviderHealth,
    ProviderError,
    RateLimitError,
    AuthenticationError,
    ChatMessage
} from "./provider.interface";
import { withRetry, CircuitBreaker, RateLimiter } from "./retry";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 2;
const API_VERSION = "2024-01-01";

interface AnthropicConfig extends ProviderConfig {
    requestsPerMinute?: number;
}

export class AnthropicProvider implements IModelProvider {
    readonly name = "anthropic";
    readonly models = ["claude-opus-4.5", "claude-sonnet-4.5", "claude-3-opus", "claude-3-sonnet"];

    private config: AnthropicConfig;
    private circuitBreaker: CircuitBreaker;
    private rateLimiter: RateLimiter;
    private lastError?: string;
    private lastErrorTime?: Date;

    constructor(config: AnthropicConfig) {
        this.config = {
            baseUrl: DEFAULT_BASE_URL,
            timeout: DEFAULT_TIMEOUT,
            maxRetries: DEFAULT_MAX_RETRIES,
            ...config
        };
        this.circuitBreaker = new CircuitBreaker("anthropic");
        this.rateLimiter = new RateLimiter(config.requestsPerMinute ?? 60);
    }

    static fromEnv(): AnthropicProvider {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error("ANTHROPIC_API_KEY environment variable is required");
        }
        return new AnthropicProvider({
            apiKey,
            baseUrl: process.env.ANTHROPIC_BASE_URL,
            requestsPerMinute: parseInt(process.env.ANTHROPIC_RPM ?? "60", 10)
        });
    }

    private async request<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
        await this.rateLimiter.acquire();

        const url = `${this.config.baseUrl}${endpoint}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
            "anthropic-version": API_VERSION
        };

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
            const match = body.match(/retry-after[:\s]+(\d+)/i);
            const retryAfter = match ? parseInt(match[1], 10) * 1000 : undefined;
            throw new RateLimitError("anthropic", retryAfter);
        }

        if (status === 401) {
            throw new AuthenticationError("anthropic");
        }

        throw new ProviderError(
            `Anthropic API error: ${body}`,
            "anthropic",
            status,
            status >= 500
        );
    }

    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const model = this.mapModel(request.model ?? "claude-sonnet-4.5");

        // Extract system message and convert to Anthropic format
        const systemMessage = request.messages.find((m) => m.role === "system");
        const userMessages = request.messages.filter((m) => m.role !== "system");

        const fn = async () => {
            const response = await this.request<{
                id: string;
                model: string;
                content: Array<{ type: string; text: string }>;
                stop_reason: string;
                usage: {
                    input_tokens: number;
                    output_tokens: number;
                };
            }>("/v1/messages", {
                model,
                max_tokens: request.max_tokens ?? 4096,
                system: systemMessage?.content,
                messages: userMessages.map((m) => ({
                    role: m.role === "assistant" ? "assistant" : "user",
                    content: m.content
                })),
                temperature: request.temperature ?? 0.7,
                stop_sequences: request.stop
            });

            const content = response.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("");

            return {
                id: response.id,
                model: response.model,
                content,
                finish_reason: this.mapStopReason(response.stop_reason),
                usage: {
                    prompt_tokens: response.usage.input_tokens,
                    completion_tokens: response.usage.output_tokens,
                    total_tokens: response.usage.input_tokens + response.usage.output_tokens
                }
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
        const modelMap: Record<string, string> = {
            "claude-opus-4.5": "claude-3-opus-20240229",
            "claude-sonnet-4.5": "claude-3-5-sonnet-20241022",
            "claude-3-opus": "claude-3-opus-20240229",
            "claude-3-sonnet": "claude-3-sonnet-20240229"
        };
        return modelMap[model] ?? model;
    }

    private mapStopReason(reason: string): ChatCompletionResponse["finish_reason"] {
        const reasonMap: Record<string, ChatCompletionResponse["finish_reason"]> = {
            end_turn: "stop",
            max_tokens: "length",
            stop_sequence: "stop",
            tool_use: "tool_calls"
        };
        return reasonMap[reason] ?? null;
    }
}
