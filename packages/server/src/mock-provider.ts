import { ModelProvider } from "./model-provider";

export class MockModelProvider implements ModelProvider {
  async generatePatch(input: {
    task_id: string;
    instructions?: string;
  }): Promise<{ patchText: string; summary: string; changedFiles: number }> {
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
      changedFiles: 1
    };
  }
}
