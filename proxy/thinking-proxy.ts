/**
 * A thin OpenAI-compatible reverse proxy that injects per-model thinking control.
 *
 * It sits in front of any OpenAI-compatible endpoint (Featherless, vLLM, ...) and,
 * for `POST .../chat/completions`, looks at the request's own `model` field and
 * merges the right `chat_template_kwargs` for that family (GLM
 * `enable_thinking`+`clear_thinking`, DeepSeek `thinking`, Kimi
 * `thinking`+`preserve_thinking`, ...). Any client — curl, the OpenAI SDK in any
 * language — gets correct thinking control without knowing each family's dialect.
 * Everything else is forwarded untouched, and responses stream straight back
 * (SSE included). The mapping lives in `agent-core/providers/reasoning-kwargs.ts`;
 * the body mutation is the tested `injectReasoningKwargs` seam.
 *
 * Per-request override: send `x-thinking: on | off | auto`. Server-wide default:
 * `PROXY_THINKING` (defaults to `auto` = each family's documented default).
 *
 * Run it:
 *   LLM_BASE_URL=https://api.featherless.ai/v1 LLM_API_KEY=… bun run proxy/thinking-proxy.ts
 *   curl localhost:8787/v1/chat/completions -H 'x-thinking: on' \
 *     -H 'content-type: application/json' \
 *     -d '{"model":"deepseek-ai/DeepSeek-V4-Flash","messages":[{"role":"user","content":"hi"}]}'
 *
 * SECURITY: this forwards arbitrary requests (and any `Authorization` header, or
 * `LLM_API_KEY` if the client sends none) straight to the upstream endpoint. Run
 * it on a trusted network only.
 */

import { injectReasoningKwargs } from "../agent-core/index.ts";
import type { ThinkingMode } from "../agent-core/index.ts";

const UPSTREAM = (process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1").replace(/\/+$/, "");
const PORT = Number(process.env.PROXY_PORT ?? 8787);
const DEFAULT_MODE = parseThinking(process.env.PROXY_THINKING) ?? "auto";

/** Parse a thinking mode from a header/env value, or undefined if not one. */
function parseThinking(value: string | null | undefined): ThinkingMode | undefined {
  return value === "on" || value === "off" || value === "auto" ? value : undefined;
}

/** Strip hop-by-hop / length headers that no longer match a rewritten body. */
function cleaned(headers: Headers): Headers {
  const out = new Headers(headers);
  out.delete("host");
  out.delete("content-length");
  out.delete("content-encoding");
  return out;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const target = `${UPSTREAM}${url.pathname}${url.search}`;
    const headers = cleaned(req.headers);
    // Fall back to the server's key only when the client didn't send one.
    if (!headers.has("authorization") && process.env.LLM_API_KEY) {
      headers.set("authorization", `Bearer ${process.env.LLM_API_KEY}`);
    }

    const isChat = req.method === "POST" && url.pathname.endsWith("/chat/completions");
    let body: BodyInit | undefined;
    if (isChat) {
      const raw = await req.text();
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const mode = parseThinking(req.headers.get("x-thinking")) ?? DEFAULT_MODE;
        // injectReasoningKwargs is a no-op for explicit kwargs / unknown / missing model.
        body = JSON.stringify(injectReasoningKwargs(parsed, mode));
        headers.set("content-type", "application/json");
      } catch {
        // Not JSON we understand — forward it verbatim rather than corrupt it.
        body = raw;
      }
    } else if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.arrayBuffer();
    }

    const upstream = await fetch(target, { method: req.method, headers, body });
    // Pass the (possibly streaming) response body straight through.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: cleaned(upstream.headers),
    });
  },
});

console.log(`thinking-proxy → ${UPSTREAM} (listening on :${server.port}, default thinking=${DEFAULT_MODE})`);
