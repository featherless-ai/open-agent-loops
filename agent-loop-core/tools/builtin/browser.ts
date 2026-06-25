/**
 * The `browser_navigate` / `browser_click` / `browser_type` tools: SDK-owned
 * wiring over the stateful {@link BrowserSession} seam.
 *
 * @remarks
 * The consumer supplies the session (the real-browser part — see
 * {@link BrowserSession | builtin.types.ts}); this fixes the model-facing contract
 * (names, schemas, snapshot shaping) so the model always sees stable browser
 * tools regardless of which engine drives the page.
 *
 * Unlike the file/search/web wiring, the three tools share one mutable session, so
 * they run {@link ExecutionMode.Sequential}: a batch of actions in the same turn
 * must apply one-at-a-time against a single page, the same reason
 * {@link scratchpadTools} serialize their shared slot. Every action returns the
 * resulting page via {@link formatBrowserSnapshot}.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import { ExecutionMode } from "../tools.types";
import type { BrowserSession, BrowserSnapshot } from "./builtin.types";

/**
 * Build the `browser_navigate`, `browser_click`, and `browser_type` tools over a
 * {@link BrowserSession}.
 *
 * @remarks
 * All three run {@link ExecutionMode.Sequential}: they drive one shared page, so
 * the loop must never run them concurrently. Each returns the resulting page,
 * shaped by {@link formatBrowserSnapshot}, so the model can pick the next
 * element's `ref`.
 *
 * @param session - The backing {@link BrowserSession}. Required — there is no
 * shipped default, because a real browser binds to a host.
 * @returns `[browser_navigate, browser_click, browser_type]`, ready for `runAgent` or a `ToolRegistry`.
 * @see {@link BrowserSession}
 * @example
 * ```ts
 * await runAgent({ ...opts, tools: browserTools(mySession) });
 * // The model can now call: browser_navigate({ url: "https://example.com" })
 * //                         browser_click({ ref: "e3" })
 * //                         browser_type({ ref: "e1", text: "hello" })
 * ```
 * @group Built-in Tools
 */
export function browserTools(session: BrowserSession): Tool[] {
  const navigate = defineTool({
    name: "browser_navigate",
    description:
      "Load a URL in the browser. Returns the resulting page: its url, title, and interactive elements as [ref] role \"name\".",
    parameters: z.object({
      url: z.string().describe("Absolute URL to load."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: async ({ url }, ctx) => ({
      content: formatBrowserSnapshot(await session.navigate(url, ctx)),
    }),
  });

  const click = defineTool({
    name: "browser_click",
    description:
      "Click an element by its ref (from the latest snapshot). Returns the resulting page.",
    parameters: z.object({
      ref: z.string().describe("A ref from the current page's elements, e.g. 'e3'."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: async ({ ref }, ctx) => ({
      content: formatBrowserSnapshot(await session.click(ref, ctx)),
    }),
  });

  const type = defineTool({
    name: "browser_type",
    description:
      "Type text into an element by its ref (from the latest snapshot). Returns the resulting page.",
    parameters: z.object({
      ref: z.string().describe("A ref from the current page's elements (a text field)."),
      text: z.string().describe("The text to type into it."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: async ({ ref, text }, ctx) => ({
      content: formatBrowserSnapshot(await session.type(ref, text, ctx)),
    }),
  });

  return [navigate, click, type];
}

/**
 * Render a page snapshot into the single text block handed to the model.
 *
 * @remarks
 * A header line (`title — url`) precedes one `[ref] role "name"` line per
 * interactive element — the addressing the model quotes back into
 * `browser_click` / `browser_type`. A page with no interactive elements yields a
 * clear note in place of the element list.
 *
 * @param snapshot - The page captured by a {@link BrowserSession} action.
 * @returns The header followed by the element list, or a `(no interactive elements)` note when empty.
 * @see {@link browserTools}
 * @group Built-in Tools
 */
export function formatBrowserSnapshot(snapshot: BrowserSnapshot): string {
  const header = `${snapshot.title} — ${snapshot.url}`;
  if (snapshot.elements.length === 0) return `${header}\n(no interactive elements)`;
  const elements = snapshot.elements
    .map((e) => `[${e.ref}] ${e.role} "${e.name}"`)
    .join("\n");
  return `${header}\n${elements}`;
}
