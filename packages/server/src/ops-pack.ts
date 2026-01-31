import path from "path";

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function renderBlock(name: string, lines: string[]): string {
  const begin = `<!-- TRCODER:BEGIN managed:${name} v1 -->`;
  const end = `<!-- TRCODER:END managed:${name} v1 -->`;
  return [begin, ...lines, end].join("\n");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function updateManagedBlocks(
  existingText: string | null,
  blocks: Record<string, string[]>
): string {
  let text = existingText ?? "# TRCODER\n";
  const ordered = Object.entries(blocks);

  for (const [name, lines] of ordered) {
    const block = renderBlock(name, lines);
    const begin = `<!-- TRCODER:BEGIN managed:${name} v1 -->`;
    const end = `<!-- TRCODER:END managed:${name} v1 -->`;
    const regex = new RegExp(`${escapeRegex(begin)}[\\s\\S]*?${escapeRegex(end)}`, "m");
    if (regex.test(text)) {
      text = text.replace(regex, block);
    } else {
      text = text.trimEnd() + "\n\n" + block + "\n";
    }
  }

  return text.trimEnd() + "\n";
}

function buildAddFilePatch(filePath: string, content: string): string {
  const normalized = normalizePath(filePath);
  const lines = content.replace(/\r?\n$/, "").split(/\r?\n/);
  return [
    `diff --git a/${normalized} b/${normalized}`,
    "new file mode 100644",
    "index 0000000..0000001",
    "--- /dev/null",
    `+++ b/${normalized}`,
    "@@",
    ...lines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

function buildReplaceFilePatch(filePath: string, oldContent: string, newContent: string): string {
  const normalized = normalizePath(filePath);
  const oldLines = oldContent.replace(/\r?\n$/, "").split(/\r?\n/);
  const newLines = newContent.replace(/\r?\n$/, "").split(/\r?\n/);
  const header = `@@ -1,${oldLines.length} +1,${newLines.length} @@`;
  return [
    `diff --git a/${normalized} b/${normalized}`,
    `--- a/${normalized}`,
    `+++ b/${normalized}`,
    header,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

export function buildOpsPackPatch(input: {
  repoName: string;
  existingTrcoder?: string | null;
  portable?: boolean;
  refresh?: boolean;
  policyFiles: Record<string, string>;
  existingFiles?: Record<string, string>;
}): { patchText: string; trcoderText: string } {
  const blocks: Record<string, string[]> = {
    profile: [
      `Repo: ${input.repoName}`,
      `Generated: ${new Date().toISOString()}`
    ],
    commands: [
      "Typecheck: pnpm -w typecheck",
      "Test: pnpm -w test",
      "Lint: pnpm -w lint",
      "Build: pnpm -w build"
    ],
    ci: [
      "CI: pnpm -w test"
    ]
  };

  const trcoderText = updateManagedBlocks(input.existingTrcoder ?? null, blocks);
  const files: Array<{ path: string; content: string; old?: string | null }> = [
    {
      path: ".trcoder/TRCODER.md",
      content: trcoderText,
      old: input.existingTrcoder ?? input.existingFiles?.[".trcoder/TRCODER.md"] ?? null
    },
    {
      path: ".trcoder/rules/core.md",
      content: [
        "# TRCODER Rules",
        "",
        "- Follow project policies in .trcoder/policies.",
        "- Always run verify gates before apply.",
        "- Keep patches small and reviewable.",
        ""
      ].join("\n"),
      old: input.existingFiles?.[".trcoder/rules/core.md"] ?? null
    },
    {
      path: ".trcoder/agents/reviewer.md",
      content: [
        "# Reviewer Agent",
        "",
        "Focus: correctness, security, and regression risks.",
        "Return concise findings and suggested fixes.",
        ""
      ].join("\n"),
      old: input.existingFiles?.[".trcoder/agents/reviewer.md"] ?? null
    },
    {
      path: ".trcoder/skills/verify/SKILL.md",
      content: [
        "# Skill: Verify",
        "",
        "Run configured verify gates and summarize failures.",
        "Use strict mode before /apply.",
        ""
      ].join("\n"),
      old: input.existingFiles?.[".trcoder/skills/verify/SKILL.md"] ?? null
    },
    {
      path: ".trcoder/hooks.json",
      content: JSON.stringify(
        {
          pre_apply: ["pnpm -w typecheck", "pnpm -w test"]
        },
        null,
        2
      ),
      old: input.existingFiles?.[".trcoder/hooks.json"] ?? null
    },
    {
      path: ".trcoder/templates/pr.md",
      content: [
        "# Summary",
        "",
        "- What changed",
        "- Why it changed",
        "",
        "# Testing",
        "",
        "- [ ] pnpm -w test",
        ""
      ].join("\n"),
      old: input.existingFiles?.[".trcoder/templates/pr.md"] ?? null
    },
    {
      path: ".trcoder/templates/adr.md",
      content: [
        "# ADR",
        "",
        "## Context",
        "",
        "## Decision",
        "",
        "## Consequences",
        ""
      ].join("\n"),
      old: input.existingFiles?.[".trcoder/templates/adr.md"] ?? null
    }
  ];

  for (const [fileName, content] of Object.entries(input.policyFiles)) {
    const policyPath = normalizePath(path.join(".trcoder", "policies", fileName));
    files.push({
      path: policyPath,
      content,
      old: input.existingFiles?.[policyPath] ?? null
    });
  }

  if (input.portable) {
    files.push({
      path: "AGENTS.md",
      content: [
        "# TRCODER Agents",
        "",
        "See .trcoder/TRCODER.md for project rules and managed blocks.",
        ""
      ].join("\n"),
      old: input.existingFiles?.["AGENTS.md"] ?? null
    });
  }

  const patchPieces = files.map((file) => {
    if (file.old !== undefined && file.old !== null) {
      return buildReplaceFilePatch(file.path, file.old, file.content);
    }
    return buildAddFilePatch(file.path, file.content);
  });

  return { patchText: patchPieces.join("\n"), trcoderText };
}
