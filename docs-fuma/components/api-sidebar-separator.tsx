"use client";

import type { ReactNode } from "react";
import { useFolderDepth } from "fumadocs-ui/components/sidebar/base";

// The generated API sidebar splits every group (Core, Memory, …) into a "Types"
// and a "Functions" separator. Fumadocs separators are flat — so by default
// those sub-headings render at the same level as the group heading above them.
// This custom Separator renders the two sub-headings as subordinate labels
// (smaller, muted, a notch more indented) so they read as nested *under* their
// group instead of as siblings of it. Every other separator keeps the default
// group styling (a faithful copy of fumadocs-ui's slot SidebarSeparator).
const SUB_HEADERS = new Set(["Types", "Functions"]);

// fumadocs-ui's getItemOffset: indentation grows with folder depth.
const itemOffset = (depth: number) => `calc(${2 + 3 * depth} * var(--spacing))`;

export function ApiSidebarSeparator({ item }: { item: { name?: ReactNode; icon?: ReactNode } }) {
  const depth = useFolderDepth();
  const isSub = typeof item.name === "string" && SUB_HEADERS.has(item.name);

  if (isSub) {
    return (
      <p
        className="mt-2 mb-0.5 px-2 text-[10px] font-medium uppercase tracking-wider text-fd-muted-foreground"
        style={{ paddingInlineStart: `calc(${2 + 3 * depth + 2} * var(--spacing))` }}
      >
        {item.name}
      </p>
    );
  }

  // Default group heading — mirrors fumadocs-ui's slot SidebarSeparator.
  return (
    <p
      className={`inline-flex items-center gap-2 mb-1 mt-6 px-2 empty:mb-0 [&_svg]:size-4 [&_svg]:shrink-0${depth === 0 ? " first:mt-0" : ""}`}
      style={{ paddingInlineStart: itemOffset(depth) }}
    >
      {item.icon}
      {item.name}
    </p>
  );
}
