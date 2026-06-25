"use client";

import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  AuiProvider,
  Suggestions,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState, type FC } from "react";
import { MyRuntimeProvider } from "./MyRuntimeProvider";

function ThreadWithSuggestions() {
  const aui = useAui({
    suggestions: Suggestions([
      {
        title: "Search the repo",
        label: "for TODO comments",
        prompt: "Search the repo for TODO and summarize what you find.",
      },
      {
        title: "What can you do",
        label: "and which tools do you have?",
        prompt: "What can you help me with, and which tools do you have?",
      },
    ]),
  });
  return (
    <AuiProvider value={aui}>
      <Thread />
    </AuiProvider>
  );
}

const ChatTitle: FC = () => {
  const title = useAuiState((s) => s.threadListItem.title);
  return <span className="truncate text-sm font-medium">{title || "New Chat"}</span>;
};

/** Light/dark toggle, matching the toggle on assistant-ui's own site. */
const ThemeToggle: FC = () => {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="ml-auto size-8"
      onClick={() => setDark((d) => !d)}
      aria-label="Toggle theme"
    >
      {dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  );
};

export default function Home() {
  return (
    <MyRuntimeProvider>
      <SidebarProvider>
        <ThreadListSidebar />
        <SidebarInset className="min-h-0">
          <header className="flex h-12 shrink-0 items-center gap-2 px-3">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 h-4" />
            <ChatTitle />
            <ThemeToggle />
          </header>
          <div className="min-h-0 flex-1">
            <ThreadWithSuggestions />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </MyRuntimeProvider>
  );
}
