import crypto from "crypto";

function sanitizeRemote(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      // Avoid ever hashing credentials that might be embedded in the remote URL.
      url.username = "";
      url.password = "";
      return url.toString();
    } catch {
      // fall through
    }
  }

  // Handle scp-like remotes: user@host:org/repo.git -> host:org/repo.git
  const at = trimmed.indexOf("@");
  if (at !== -1) return trimmed.slice(at + 1);
  return trimmed;
}

export async function getRepoCommit(): Promise<string> {
  try {
    const { execSync } = await import("child_process");
    const output = execSync("git log -1 --format=%H").toString().trim();
    return output || "DEV";
  } catch {
    return "DEV";
  }
}

export async function getRepoIdentityHash(): Promise<string> {
  try {
    const { execSync } = await import("child_process");
    const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim() || process.cwd();
    let remote = "";
    try {
      remote = execSync("git remote get-url origin").toString().trim();
    } catch {
      remote = "";
    }

    const identity = `${repoRoot}\n${sanitizeRemote(remote)}`;
    return crypto.createHash("sha256").update(identity).digest("hex");
  } catch {
    // Non-git fallback: stable enough on the same machine.
    return crypto.createHash("sha256").update(process.cwd()).digest("hex");
  }
}

