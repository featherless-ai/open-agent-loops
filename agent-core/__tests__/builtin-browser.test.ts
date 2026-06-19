import { describe, expect, test } from "bun:test";
import { browserTools, formatBrowserSnapshot } from "../tools/builtin/browser";
import { MockBrowserSession } from "../mocks/mock-browser";
import { toToolSpec, validateToolArguments } from "../tools/tools";
import { ExecutionMode } from "../tools/tools.types";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { BrowserSnapshot } from "../tools/builtin/builtin.types";
import type { ToolCall } from "../types";
import { Role, ToolCallType } from "../types";

const ctx = { toolCallId: "c1" };

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: "c1",
  type: ToolCallType.Function,
  function: { name, arguments: JSON.stringify(args) },
});

/** Resolve a browser tool bound to a session; the shared-state tools need a specific one. */
const byNameOn = (session: MockBrowserSession, name: string) =>
  browserTools(session).find((t) => t.name === name)!;

/** Resolve a tool whose session is irrelevant to the assertion (validation, spec shape). */
const byName = (name: string) => byNameOn(new MockBrowserSession(), name);

const page: BrowserSnapshot = {
  url: "https://site",
  title: "Home",
  elements: [
    { ref: "e1", role: "textbox", name: "Search" },
    { ref: "e2", role: "button", name: "Go" },
  ],
};

describe("browserTools", () => {
  // Base case: navigate renders the page as title — url then [ref] role "name".
  test("base: navigate renders the snapshot", async () => {
    const session = new MockBrowserSession(page);
    const result = await byNameOn(session, "browser_navigate").execute(
      { url: "https://site" } as never,
      ctx,
    );

    expect(result.content).toBe(
      'Home — https://site\n[e1] textbox "Search"\n[e2] button "Go"',
    );
    expect(session.actions[0]?.action).toEqual({ kind: "navigate", url: "https://site" });
  });

  // Edge: click forwards the ref and returns the resulting page.
  test("edge: click forwards ref", async () => {
    const session = new MockBrowserSession(page);
    await byNameOn(session, "browser_click").execute({ ref: "e2" } as never, ctx);
    expect(session.actions[0]?.action).toEqual({ kind: "click", ref: "e2" });
  });

  // Edge: type forwards ref and text.
  test("edge: type forwards ref and text", async () => {
    const session = new MockBrowserSession(page);
    await byNameOn(session, "browser_type").execute(
      { ref: "e1", text: "hello" } as never,
      ctx,
    );
    expect(session.actions[0]?.action).toEqual({ kind: "type", ref: "e1", text: "hello" });
  });

  // Edge: the three tools share one page, so they must run sequentially.
  test("edge: all tools are Sequential", () => {
    for (const tool of browserTools(new MockBrowserSession())) {
      expect(tool.executionMode).toBe(ExecutionMode.Sequential);
    }
  });

  // Edge: a missing ref fails validation on click.
  test("edge: missing ref fails validation", () => {
    expect(() => validateToolArguments(byName("browser_click"), call("browser_click", {}))).toThrow(
      /ref/,
    );
  });

  // Edge: the model-facing spec advertises the stable name + url param.
  test("edge: toToolSpec advertises navigate name and url param", () => {
    const spec = toToolSpec(byName("browser_navigate"));
    expect(spec.name).toBe("browser_navigate");
    expect((spec.parameters as any).properties.url.type).toBe("string");
  });

  // Integration: a scripted state machine drives a runAgent navigate -> click flow.
  test("integration: drives a navigate -> click flow in runAgent", async () => {
    const next: BrowserSnapshot = { url: "https://site/r", title: "Result", elements: [] };
    const session = new MockBrowserSession((action) =>
      action.kind === "navigate" ? page : next,
    );
    const model = new MockModelClient([
      { toolCalls: [{ name: "browser_navigate", arguments: { url: "https://site" } }] },
      { toolCalls: [{ name: "browser_click", arguments: { ref: "e2" } }] },
      { text: "done" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: browserTools(session),
    });

    const toolResults = result.messages.filter((m) => m.role === Role.Tool);
    expect(toolResults[1]?.content).toBe("Result — https://site/r\n(no interactive elements)");
    expect(result.messages.at(-1)?.content).toBe("done");
    expect(session.actions.map((a) => a.action.kind)).toEqual(["navigate", "click"]);
  });
});

describe("formatBrowserSnapshot", () => {
  // Edge: a page with no interactive elements gets a clear note.
  test("edge: no elements yields a clear note", () => {
    expect(
      formatBrowserSnapshot({ url: "https://x", title: "X", elements: [] }),
    ).toBe("X — https://x\n(no interactive elements)");
  });
});
