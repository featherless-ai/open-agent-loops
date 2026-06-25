/**
 * A sample skill for the kitchen-sink assistant.
 *
 * A skill is a named bundle: a one-line description (always cheap, shown in the
 * catalog), instructions (disclosed only when the model calls `skill`), and any
 * tools it contributes. This one teaches a disciplined research method and adds
 * a `format_citation` tool.
 */
import { defineTool } from "@open-agent-loops/core";
import type { Skill } from "@open-agent-loops/core";
import { z } from "zod";

const formatCitation = defineTool({
  name: "format_citation",
  description: "Format a file:line reference as a clickable markdown citation.",
  parameters: z.object({
    file: z.string().describe("Path to the file."),
    line: z.number().describe("1-based line number."),
  }),
  execute: ({ file, line }) => ({ content: `[${file}:${line}](${file}#L${line})` }),
});

export const researchSkill: Skill = {
  name: "deep_research",
  description: "Investigate a question across the repo and produce a cited summary.",
  instructions: [
    "When asked to research something in this repository:",
    "1. Use `search` to locate relevant files (start broad, then narrow the pattern).",
    "2. Use `shell` (e.g. `sed -n '1,40p' path`) to read the lines that matter.",
    "3. Track findings in the to-do list and jot quotes in the scratchpad.",
    "4. Summarize, and cite each claim with `format_citation({ file, line })`.",
  ].join("\n"),
  tools: [formatCitation],
};
