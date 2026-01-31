import { CliConfig } from "./config-store";

export async function streamRunEvents(
  config: CliConfig,
  runId: string,
  onEvent: (event: { type: string; ts: string; data: any }) => void
): Promise<void> {
  const res = await fetch(`${config.server_url}/v1/runs/${runId}/stream`, {
    headers: { Authorization: `Bearer ${config.api_key}` }
  });

  if (!res.ok || !res.body) {
    throw new Error(`SSE connect failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);

      const lines = rawEvent.split(/\n/);
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""));

      if (dataLines.length > 0) {
        const dataStr = dataLines.join("\n");
        try {
          const event = JSON.parse(dataStr) as { type: string; ts: string; data: any };
          onEvent(event);
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}
