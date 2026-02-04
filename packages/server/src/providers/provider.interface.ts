/**
 * LLM Provider Interface
 * 
 * This module defines the contract for LLM providers and includes
 * common utilities for retry, circuit breaker, and streaming.
 */

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface ChatCompletionRequest {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
    stop?: string[];
    stream?: boolean;
}

export interface ChatCompletionResponse {
    id: string;
    model: string;
    content: string;
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface StreamChunk {
    delta: string;
    finish_reason: ChatCompletionResponse["finish_reason"];
}

export interface ProviderHealth {
    healthy: boolean;
    latencyMs: number;
    lastError?: string;
    lastErrorTime?: Date;
}

export interface IModelProvider {
    readonly name: string;
    readonly models: string[];

    /**
     * Send a chat completion request and get a response
     */
    chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

    /**
     * Send a streaming chat completion request
     */
    chatStream?(
        request: ChatCompletionRequest,
        onChunk: (chunk: StreamChunk) => void
    ): Promise<ChatCompletionResponse>;

    /**
     * Generate a patch for a task (convenience method)
     */
    generatePatch(input: {
        task_id: string;
        instructions?: string;
        context?: string;
    }): Promise<{ patchText: string; summary: string; changedFiles: number; usage: ChatCompletionResponse["usage"] }>;

    /**
     * Check provider health
     */
    healthCheck(): Promise<ProviderHealth>;
}

export interface ProviderConfig {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
    organization?: string;
}

// Provider-specific model mappings for routing
export const PROVIDER_MODELS: Record<string, string[]> = {
    openai: ["gpt-5.2-xhigh", "gpt-4o", "gpt-4-turbo"],
    anthropic: ["claude-opus-4.5", "claude-sonnet-4.5"],
    google: ["gemini-3.0-pro", "gemini-2.0-ultra"]
};

// Model to provider mapping
export function getProviderForModel(model: string): string | null {
    for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        if (models.includes(model)) {
            return provider;
        }
    }
    return null;
}

// Base error class for provider errors
export class ProviderError extends Error {
    constructor(
        message: string,
        public readonly provider: string,
        public readonly statusCode?: number,
        public readonly retryable: boolean = false,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = "ProviderError";
    }
}

export class RateLimitError extends ProviderError {
    constructor(
        provider: string,
        public readonly retryAfterMs?: number,
        cause?: Error
    ) {
        super(`Rate limit exceeded for ${provider}`, provider, 429, true, cause);
        this.name = "RateLimitError";
    }
}

export class AuthenticationError extends ProviderError {
    constructor(provider: string, cause?: Error) {
        super(`Authentication failed for ${provider}`, provider, 401, false, cause);
        this.name = "AuthenticationError";
    }
}

export class ModelNotFoundError extends ProviderError {
    constructor(provider: string, model: string, cause?: Error) {
        super(`Model ${model} not found for ${provider}`, provider, 404, false, cause);
        this.name = "ModelNotFoundError";
    }
}
