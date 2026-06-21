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
  // Base: builds the URL, the env-placeholder auth header, and a single-quoted
  // body — and escapes the apostrophe in the message content so the shell is safe.
  test("base: renders a runnable curl with a safely quoted body", () => {
    const out = toCurl(body, { baseURL: "https://api.featherless.ai/v1", apiKeyEnv: "LLM_API_KEY" });

    expect(out).toContain("curl -N https://api.featherless.ai/v1/chat/completions");
    expect(out).toContain(`-H "Authorization: Bearer $LLM_API_KEY"`);
    expect(out).toContain("-H 'Content-Type: application/json'");
    // the whole body is one single-quoted -d arg, apostrophe escaped as '\''
    expect(out).toContain(`"content":"what'\\''s the weather?"`);
    // and the secret name is a placeholder, never an actual key
    expect(out).not.toContain("rc_");
  });

  // The body is reproduced verbatim: round-tripping the -d payload recovers it.
  test("preserves the body verbatim (tool-call history included)", () => {
    const out = toCurl(body, { baseURL: "https://x/v1" });
    const payload = out.slice(out.indexOf("-d '") + 4, out.lastIndexOf("'"));
    expect(JSON.parse(payload.replace(/'\\''/g, "'"))).toEqual(body);
  });

  // stream override flips the captured flag; omitting it keeps the body as-is.
  test("stream override flips the flag; omission keeps it", () => {
    expect(toCurl(body, { baseURL: "https://x/v1", stream: false })).toContain('"stream":false');
    expect(toCurl(body, { baseURL: "https://x/v1" })).toContain('"stream":true');
  });

  // Defaults: /chat/completions path and $API_KEY; trailing slash is normalized.
  test("applies defaults and normalizes a trailing slash", () => {
    const out = toCurl({ model: "m" }, { baseURL: "https://x/v1/" });
    expect(out).toContain("curl -N https://x/v1/chat/completions");
    expect(out).toContain(`Bearer $API_KEY`);
  });
});
