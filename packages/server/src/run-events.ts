import { ServerResponse } from "http";

export interface SseEvent {
  type: string;
  ts: string;
  data: unknown;
}

export class RunEventHub {
  private events = new Map<string, SseEvent[]>();
  private clients = new Map<string, Set<ServerResponse>>();

  emit(runId: string, event: SseEvent): void {
    const list = this.events.get(runId) ?? [];
    list.push(event);
    this.events.set(runId, list);

    const clients = this.clients.get(runId);
    if (clients) {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) {
        client.write(payload);
      }
    }
  }

  attach(runId: string, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const list = this.events.get(runId) ?? [];
    for (const event of list) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    let set = this.clients.get(runId);
    if (!set) {
      set = new Set();
      this.clients.set(runId, set);
    }
    set.add(res);

    res.on("close", () => {
      set?.delete(res);
    });
  }
}
