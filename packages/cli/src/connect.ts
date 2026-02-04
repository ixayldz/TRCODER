import path from "path";
import { ApiClient } from "./api-client";
import { CliConfig, loadConfig, saveConfig } from "./config-store";
import { ensureLocalServerRunning } from "./local-server";
import { getRepoIdentityHash } from "./repo";

export async function connectCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--server" && args[i + 1]) {
      config.server_url = args[i + 1];
      i += 1;
    }
    if (args[i] === "--api-key" && args[i + 1]) {
      config.api_key = args[i + 1];
      i += 1;
    }
  }

  await ensureLocalServerRunning({
    serverUrl: config.server_url,
    apiKey: config.api_key,
    log: (message) => console.log(message)
  });

  const api = new ApiClient(config as CliConfig);
  const repo_name = path.basename(process.cwd());
  const repo_root_hash = await getRepoIdentityHash();
  const res = await api.post<{ project_id: string }>("/v1/projects/connect", {
    repo_name,
    repo_root_hash
  });

  config.project_id = res.project_id;
  config.storage = config.storage ?? { method: "file", encrypted: false };
  saveConfig(config);

  console.log(`Connected project: ${res.project_id}`);
  if (config.storage.method === "file" && !config.storage.encrypted) {
    console.log(
      "Security note: API key is stored locally in plain text. Prefer OS keychain storage when available."
    );
  }
}
