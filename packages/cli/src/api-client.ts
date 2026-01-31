import { CliConfig } from "./config-store";

export class ApiClient {
  constructor(private config: CliConfig) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.config.api_key}`,
      "Content-Type": "application/json"
    } as Record<string, string>;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.config.server_url}${path}`, {
      headers: this.headers()
    });
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.config.server_url}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }
}
