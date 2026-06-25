/**
 * The `read_scratchpad` / `write_scratchpad` tools: the agent's private working
 * memory for long-running tasks.
 *
 * @remarks
 * Unlike {@link ShellBackend | builtin.types.ts} / `SearchBackend`, this binds
 * to no host — it is pure in-memory state — so the core ships a working default
 * ({@link InMemoryScratchpad}) instead of forcing the consumer to implement one.
 * The {@link Scratchpad} seam exists only for *extensibility* (back it with a
 * file or DB if you want notes to outlive the process), exactly the shape of the
 * `Memory` seam and its `SessionMemoryStore` default — not the must-implement
 * shape of the dangerous host-binding backends.
 *
 * The benefit is forcing the model to think a task through and stash the plan
 * somewhere durable: a turn's reasoning is dropped from later requests (see
 * `prepareRequestMessages`), but a scratchpad write folds back into the
 * conversation as a tool result, so the plan survives across many turns.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import { ExecutionMode } from "../tools.types";

/**
 * The scratchpad seam — a single slot of free-form text the agent reads and
 * overwrites.
 *
 * @remarks
 * Swap the shipped {@link InMemoryScratchpad} for a file/DB-backed implementation
 * if you want the notes to outlive the process or be shared across sessions.
 *
 * @group Planning Tools
 */
export interface Scratchpad {
  /** Return the current contents (an implementation decides how "empty" reads). */
  read(): string;
  /** Replace the contents wholesale, returning what was stored. */
  write(content: string): string;
}

/**
 * In-memory {@link Scratchpad} — the shipped default.
 *
 * @remarks
 * One string, replaced on each write and trimmed of surrounding whitespace. An
 * empty pad reads as `"(empty)"` so the model gets a clear signal rather than a
 * blank line.
 *
 * @group Planning Tools
 */
export class InMemoryScratchpad implements Scratchpad {
  private content = "";

  /** @returns The stored text, or `"(empty)"` when nothing has been written. */
  read(): string {
    return this.content === "" ? "(empty)" : this.content;
  }

  /**
   * @param content - The new text; trimmed and stored, replacing what was there.
   * @returns The trimmed text now stored.
   */
  write(content: string): string {
    this.content = content.trim();
    return this.content;
  }
}

/**
 * Build the `read_scratchpad` and `write_scratchpad` tools over a {@link Scratchpad}.
 *
 * @remarks
 * Both run {@link ExecutionMode.Sequential}: they share one mutable slot, so a
 * read batched alongside a write in the same turn must never race it.
 *
 * @param scratchpad - The backing store. Defaults to a fresh {@link InMemoryScratchpad}.
 * @returns `[read_scratchpad, write_scratchpad]`, ready for `runAgent` or a `ToolRegistry`.
 * @see {@link Scratchpad}
 * @example
 * ```ts
 * const pad = new InMemoryScratchpad();
 * await runAgent({ ...opts, tools: scratchpadTools(pad) });
 * // The model can now call: write_scratchpad({ content: "Plan: ..." }) / read_scratchpad({})
 * ```
 * @group Planning Tools
 */
export function scratchpadTools(scratchpad: Scratchpad = new InMemoryScratchpad()): Tool[] {
  const read = defineTool({
    name: "read_scratchpad",
    description:
      'Read your private scratchpad — the working notes you saved earlier. ' +
      'Returns "(empty)" if you have not written anything yet.',
    parameters: z.object({}),
    executionMode: ExecutionMode.Sequential,
    execute: () => ({ content: scratchpad.read() }),
  });

  const write = defineTool({
    name: "write_scratchpad",
    description:
      "Write your private scratchpad, fully replacing any previous contents. " +
      "Use it to plan an approach or hold findings across steps before acting.",
    parameters: z.object({
      content: z.string().describe("The full text to store; replaces what was there."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: ({ content }) => {
      scratchpad.write(content);
      return { content: "Saved to scratchpad." };
    },
  });

  return [read, write];
}
