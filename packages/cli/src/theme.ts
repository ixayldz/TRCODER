type ThemeMode = "matrix" | "none";
type StyleKind = "prompt" | "header" | "label" | "stage" | "muted";

const THEME: ThemeMode = (process.env.TRCODER_THEME ?? "matrix") as ThemeMode;
const USE_COLOR = Boolean(process.stdout.isTTY && !process.env.NO_COLOR && THEME !== "none");

const ANSI = {
  reset: "\x1b[0m",
  brightGreen: "\x1b[92m",
  green: "\x1b[32m",
  dim: "\x1b[2m"
};

export function styleText(text: string, kind: StyleKind): string {
  if (!USE_COLOR) return text;
  switch (kind) {
    case "prompt":
      return `${ANSI.brightGreen}${text}${ANSI.reset}`;
    case "header":
      return `${ANSI.brightGreen}${text}${ANSI.reset}`;
    case "stage":
      return `${ANSI.green}${text}${ANSI.reset}`;
    case "label":
      return `${ANSI.dim}${text}${ANSI.reset}`;
    case "muted":
      return `${ANSI.dim}${text}${ANSI.reset}`;
    default:
      return text;
  }
}
