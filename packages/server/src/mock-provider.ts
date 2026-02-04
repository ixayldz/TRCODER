import {
  IModelProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderHealth
} from "./providers/provider.interface";

export class MockModelProvider implements IModelProvider {
  readonly name = "mock";
  readonly models = ["mock"];

  async chat(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return {
      id: `mock-${Date.now()}`,
      model: "mock",
      content: "Mock response",
      finish_reason: "stop",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }

  async generatePatch(input: {
    task_id: string;
    instructions?: string;
    context?: string;
  }): Promise<{ patchText: string; summary: string; changedFiles: number; usage: ChatCompletionResponse["usage"] }> {
    const filePath = `.trcoder/patches/${input.task_id}.txt`;
    const contentLine = `Mock patch for ${input.task_id}`;
    const patchText = [
      `diff --git a/${filePath} b/${filePath}`,
      "new file mode 100644",
      "index 0000000..0000001",
      "--- /dev/null",
      `+++ b/${filePath}`,
      "@@",
      `+${contentLine}`,
      ""
    ].join("\n");

    return {
      patchText,
      summary: `Add ${filePath}`,
      changedFiles: 1,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, latencyMs: 0 };
  }
}
