export interface ModelProvider {
  generatePatch(input: {
    task_id: string;
    instructions?: string;
  }): Promise<{ patchText: string; summary: string; changedFiles: number }>;
}
