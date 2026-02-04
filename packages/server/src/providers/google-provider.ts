/**
 * Google (Gemini) Provider Implementation
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
    ModelNotFoundError
} from "./provider.interface";
import { withRetry, CircuitBreaker, RateLimiter } from "./retry";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 2;

interface GoogleConfig extends ProviderConfig {
    requestsPerMinute?: number;
}

export class GoogleProvider implements IModelProvider {
    readonly name = "google";
    readonly models = ["gemini-3.0-pro", "gemini-2.0-ultra", "gemini-1.5-pro", "gemini-1.5-flash"];

    private config: GoogleConfig;
    private circuitBreaker: CircuitBreaker;
    private rateLimiter: RateLimiter;
    private lastError?: string;
    private lastErrorTime?: Date;

    constructor(config: GoogleConfig) {
        this.config = {
            baseUrl: DEFAULT_BASE_URL,
            timeout: DEFAULT_TIMEOUT,
            maxRetries: DEFAULT_MAX_RETRIES,
            ...config
        };
        this.circuitBreaker = new CircuitBreaker("google");
        this.rateLimiter = new RateLimiter(config.requestsPerMinute ?? 60);
    }

    static fromEnv(): GoogleProvider {
        const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GOOGLE_API_KEY environment variable is required");
        }
        return new GoogleProvider({
            apiKey,
            baseUrl: process.env.GOOGLE_BASE_URL ?? process.env.GEMINI_BASE_URL,
            requestsPerMinute: parseInt(process.env.GOOGLE_RPM ?? "60", 10)
        });
    }

    private async request<T>(
        model: string,
        body: Record<string, unknown>
    ): Promise<T> {
        await this.rateLimiter.acquire();

        const resolvedModel = this.mapModel(model);
        const url = `${this.config.baseUrl}/models/${resolvedModel}:generateContent?key=${this.config.apiKey}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json"
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
            throw new RateLimitError("google");
        }

        if (status === 401 || status === 403) {
            throw new AuthenticationError("google");
        }

        if (status === 404) {
            throw new ModelNotFoundError("google", "unknown");
        }

        throw new ProviderError(
            `Google API error: ${body}`,
            "google",
            status,
            status >= 500
        );
    }

    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const systemMessage = request.messages.find((m) => m.role === "system");
        const conversation = request.messages.filter((m) => m.role !== "system");
        const resolvedModel = this.mapModel(request.model ?? "gemini-1.5-pro");

        const contents = conversation.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
        }));

        const fn = async () => {
            const response = await this.request<{
                candidates?: Array<{
                    content?: { parts?: Array<{ text?: string }> };
                    finishReason?: string;
                }>;
                usageMetadata?: {
                    promptTokenCount?: number;
                    candidatesTokenCount?: number;
                    totalTokenCount?: number;
                };
            }>(resolvedModel, {
                contents,
                systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
                generationConfig: {
                    temperature: request.temperature ?? 0.7,
                    maxOutputTokens: request.max_tokens ?? 4096,
                    stopSequences: request.stop
                }
            });

            const candidate = response.candidates?.[0];
            const content = candidate?.content?.parts
                ?.map((part) => part.text ?? "")
                .join("") ?? "";
            const usage = response.usageMetadata ?? {};

            return {
                id: `google-${Date.now()}`,
                model: resolvedModel,
                content,
                finish_reason: this.mapFinishReason(candidate?.finishReason ?? ""),
                usage: {
                    prompt_tokens: usage.promptTokenCount ?? 0,
                    completion_tokens: usage.candidatesTokenCount ?? 0,
                    total_tokens: usage.totalTokenCount ?? 0
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
            max_tokens: 8192,
            model: "gemini-1.5-pro"
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
                max_tokens: 1,
                model: "gemini-1.5-pro"
            });
            return {
                healthy: true,
                latencyMs: Date.now() - start
            };
        } catch {
            return {
                healthy: false,
                latencyMs: Date.now() - start,
                lastError: this.lastError,
                lastErrorTime: this.lastErrorTime
            };
        }
    }

    private mapFinishReason(reason: string): ChatCompletionResponse["finish_reason"] {
        const normalized = reason.toUpperCase();
        if (normalized === "STOP") return "stop";
        if (normalized === "MAX_TOKENS") return "length";
        return null;
    }

    private mapModel(model: string): string {
        const modelMap: Record<string, string> = {
            "gemini-3.0-pro": "gemini-1.5-pro",
            "gemini-2.0-ultra": "gemini-1.5-pro",
            "gemini-1.5-pro": "gemini-1.5-pro",
            "gemini-1.5-flash": "gemini-1.5-flash"
        };
        return modelMap[model] ?? model;
    }
}
