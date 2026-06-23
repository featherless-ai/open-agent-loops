import { describe, expect, test } from "bun:test";
import {
  formatWebFetchResult,
  formatWebSearchResults,
  webFetchTool,
  webSearchTool,
} from "../tools/builtin/web";
import { MockWebBackend } from "../mocks/mock-web";
import { toToolSpec, validateToolArguments } from "../tools/tools";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { ToolCall } from "../types";
import { Role, ToolCallType } from "../types";

const ctx = { toolCallId: "c1" };

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: "c1",
  type: ToolCallType.Function,
  function: { name, arguments: JSON.stringify(args) },
});

describe("webSearchTool", () => {
  // Base case: hits render as numbered title — url / snippet blocks.
  test("base: renders hits as numbered blocks", async () => {
    const backend = new MockWebBackend([
      { title: "First", url: "https://a.com", snippet: "alpha" },
      { title: "Second", url: "https://b.com", snippet: "beta" },
    ]);
    const result = await webSearchTool(backend).execute({ query: "x" } as never, ctx);

    expect(result.content).toBe(
      "[1] First — https://a.com\nalpha\n\n[2] Second — https://b.com\nbeta",
    );
  });

  // Edge: no hits gives a clear note rather than an empty string.
  test("edge: no results yields a clear note", async () => {
    const result = await webSearchTool(new MockWebBackend()).execute(
      { query: "nope" } as never,
      ctx,
    );
    expect(result.content).toBe("No results found.");
  });

  // Edge: every optional field is forwarded to the backend verbatim.
  test("edge: forwards query and maxResults", async () => {
    const backend = new MockWebBackend();
    await webSearchTool(backend).execute({ query: "foo", maxResults: 3 } as never, ctx);
    expect(backend.searches[0]?.query).toEqual({ query: "foo", maxResults: 3 });
  });

  // Edge: the schema requires a query string.
  test("edge: missing query fails validation", () => {
    expect(() =>
      validateToolArguments(webSearchTool(new MockWebBackend()), call("web_search", {})),
    ).toThrow(/query/);
  });

  // Edge: the model-facing spec advertises the stable name + query param.
  test("edge: toToolSpec advertises name and query param", () => {
    const spec = toToolSpec(webSearchTool(new MockWebBackend()));
    expect(spec.name).toBe("web_search");
    expect((spec.parameters as any).properties.query.type).toBe("string");
  });

  // Integration: the tool folds into runAgent (search -> result -> answer).
  test("integration: drives a runAgent tool turn", async () => {
    const backend = new MockWebBackend([
      { title: "Hit", url: "https://h.com", snippet: "here" },
    ]);
    const model = new MockModelClient([
      { toolCalls: [{ name: "web_search", arguments: { query: "hit" } }] },
      { text: "found it" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "search hit",
      tools: [webSearchTool(backend)],
    });

    expect(result.messages.find((m) => m.role === Role.Tool)?.content).toBe(
      "[1] Hit — https://h.com\nhere",
    );
    expect(result.messages.at(-1)?.content).toBe("found it");
    expect(backend.searches[0]?.query.query).toBe("hit");
  });
});

describe("webFetchTool", () => {
  // Base case: a header (url, status, content type) precedes the body.
  test("base: renders header then body", async () => {
    const backend = new MockWebBackend([], {
      url: "https://a.com",
      status: 200,
      contentType: "text/html",
      text: "hello",
    });
    const result = await webFetchTool(backend).execute({ url: "https://a.com" } as never, ctx);

    expect(result.content).toBe("https://a.com (200 text/html)\n\nhello");
  });

  // Edge: an empty body renders the (no content) placeholder.
  test("edge: empty body yields a placeholder", async () => {
    const backend = new MockWebBackend([], {
      url: "https://a.com",
      status: 204,
      contentType: "text/plain",
      text: "",
    });
    const result = await webFetchTool(backend).execute({ url: "https://a.com" } as never, ctx);
    expect(result.content).toBe("https://a.com (204 text/plain)\n\n(no content)");
  });

  // Edge: url and maxBytes are forwarded to the backend verbatim.
  test("edge: forwards url and maxBytes", async () => {
    const backend = new MockWebBackend();
    await webFetchTool(backend).execute(
      { url: "https://a.com", maxBytes: 1024 } as never,
      ctx,
    );
    expect(backend.fetches[0]?.request).toEqual({ url: "https://a.com", maxBytes: 1024 });
  });

  // Edge: the schema requires a url string.
  test("edge: missing url fails validation", () => {
    expect(() =>
      validateToolArguments(webFetchTool(new MockWebBackend()), call("web_fetch", {})),
    ).toThrow(/url/);
  });
});

describe("formatWebSearchResults", () => {
  // Edge: an empty list is the "no results" sentinel.
  test("edge: empty list renders the no-results note", () => {
    expect(formatWebSearchResults([])).toBe("No results found.");
  });
});

describe("formatWebFetchResult", () => {
  // Edge: a non-200 status is surfaced in the header.
  test("edge: surfaces a non-200 status", () => {
    expect(
      formatWebFetchResult({
        url: "https://a.com",
        status: 404,
        contentType: "text/html",
        text: "missing",
      }),
    ).toBe("https://a.com (404 text/html)\n\nmissing");
  });
});
