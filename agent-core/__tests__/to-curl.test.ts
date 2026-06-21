import { describe, expect, test } from "bun:test";
import { toCurl } from "../observability/to-curl";

/** A captured chat-completion body with a tool-call history and an apostrophe. */
const body = {
  model: "deepseek-ai/DeepSeek-V4-Flash",
  stream: true,
  messages: [
    { role: "user", content: "what's the weather?" },
    { role: "assistant", content: "", tool_calls: [{ id: "call_0", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } }] },
    { role: "tool", tool_call_id: "call_0", content: "Sunny in Paris" },
  ],
  tools: [{ type: "function", function: { name: "weather" } }],
};

describe("toCurl", () => {
  // Base: URL, env-placeholder auth header, single-quoted body; the apostrophe in
  // the content is escaped so the shell is safe. Pretty-printed by default.
  test("base: renders a readable, safely quoted curl", () => {
    const out = toCurl(body, { baseURL: "https://api.featherless.ai/v1", apiKeyEnv: "LLM_API_KEY" });

    expect(out).toContain("curl -N https://api.featherless.ai/v1/chat/completions");
    expect(out).toContain(`-H "Authorization: Bearer $LLM_API_KEY"`);
    expect(out).toContain("-H 'Content-Type: application/json'");
    // pretty by default: the body spans multiple indented lines
    expect(out).toContain("-d '{\n");
    expect(out).toContain(`\n  "model": "deepseek-ai/DeepSeek-V4-Flash"`);
    // apostrophe in content escaped as '\'' (now with a space after the colon)
    expect(out).toContain(`"content": "what'\\''s the weather?"`);
    // and the secret name is a placeholder, never an actual key
    expect(out).not.toContain("rc_");
  });

  // pretty: false → a compact one-liner, handy for scripting or -d @file.
  test("pretty: false produces a compact one-line body", () => {
    const out = toCurl(body, { baseURL: "https://x/v1", pretty: false });
    expect(out).toContain(`-d '{"model":"deepseek-ai/DeepSeek-V4-Flash"`);
    expect(out).not.toContain("-d '{\n");
    expect(out).toContain(`"content":"what'\\''s the weather?"`);
  });

  // The body is reproduced verbatim: round-tripping the -d payload recovers it.
  test("preserves the body verbatim (tool-call history included)", () => {
    const out = toCurl(body, { baseURL: "https://x/v1", pretty: false });
    const payload = out.slice(out.indexOf("-d '") + 4, out.lastIndexOf("'"));
    expect(JSON.parse(payload.replace(/'\\''/g, "'"))).toEqual(body);
  });

  // stream override flips the captured flag; omitting it keeps the body as-is.
  test("stream override flips the flag; omission keeps it", () => {
    expect(toCurl(body, { baseURL: "https://x/v1", stream: false })).toMatch(/"stream":\s*false/);
    expect(toCurl(body, { baseURL: "https://x/v1" })).toMatch(/"stream":\s*true/);
  });

  // Defaults: /chat/completions path and $API_KEY; trailing slash is normalized.
  test("applies defaults and normalizes a trailing slash", () => {
    const out = toCurl({ model: "m" }, { baseURL: "https://x/v1/" });
    expect(out).toContain("curl -N https://x/v1/chat/completions");
    expect(out).toContain(`Bearer $API_KEY`);
  });
});
