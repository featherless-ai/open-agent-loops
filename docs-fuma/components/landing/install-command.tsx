"use client";

import { useState } from "react";

/**
 * A copy-to-clipboard install pill: `npm i @open-agent-loops/agent-loop-core`. Mono, bordered,
 * with a tiny check confirmation. Client-only because it touches the clipboard.
 */
export function InstallCommand({ command = "npm i @open-agent-loops/agent-loop-core" }: { command?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (e.g. insecure context) — no-op, the text is still selectable
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy: ${command}`}
      className="group inline-flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 font-mono text-sm text-fd-foreground transition-colors hover:border-fd-primary/60"
    >
      <span className="select-all">
        <span className="text-fd-muted-foreground">$ </span>
        {command}
      </span>
      <span className="text-fd-muted-foreground group-hover:text-fd-primary">
        {copied ? "✓ copied" : "copy"}
      </span>
    </button>
  );
}
