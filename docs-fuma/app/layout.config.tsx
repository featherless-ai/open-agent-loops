import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { LoopMark } from "@/components/loop-mark";

// Shared chrome (navbar) for every layout.
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="inline-flex items-center gap-2 font-semibold">
        <LoopMark />
        Open Agent OS
      </span>
    ),
  },
};
