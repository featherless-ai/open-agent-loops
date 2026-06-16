/**
 * Shared console-formatting helpers for the runnable examples. Pure
 * presentation — no agent logic — so every example renders colors the same way.
 */

// ANSI colors, disabled when stdout isn't a TTY (e.g. piped to a file) or when
// NO_COLOR is set, so redirected output stays free of escape codes.
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
} as const;

export const color = (code: string, text: string) =>
  useColor ? `${code}${text}${ANSI.reset}` : text;
