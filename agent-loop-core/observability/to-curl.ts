/**
 * to-curl — reconstruct a runnable `curl` from a captured request body.
 *
 * The `Tracer`'s `onRawRequest` tap records the exact JSON the provider POSTs
 * each turn (a {@link RawRequest}). That body is the whole `-d` payload —
 * `messages` (system folded in, every `tool_calls` block and `tool` result),
 * `tools`, and sampling params. The only things not in it are the endpoint URL
 * (from {@link TraceMeta.baseURL}) and the auth header (kept as an env
 * placeholder, never captured). This stitches those together into a command you
 * can paste to replay the call.
 *
 * @example
 * ```ts
 * const reqs = tracer.entries.filter((e) => e.label === "request_body");
 * const body = (reqs[0]!.data as { body: unknown }).body;
 * console.log(toCurl(body, { baseURL: tracer.meta.baseURL!, apiKeyEnv: "LLM_API_KEY", stream: false }));
 * ```
 *
 * @module
 */

/** Options for {@link toCurl}. */
export interface ToCurlOptions {
  /** Endpoint base URL, e.g. "https://api.featherless.ai/v1" (a trailing slash is fine). */
  baseURL: string;
  /** Request path appended to `baseURL`. Default "/chat/completions". */
  path?: string;
  /**
   * Name of the env var holding the API key, referenced as `$NAME` in the
   * Authorization header — so the key itself never lands in the command.
   * Default "API_KEY".
   */
  apiKeyEnv?: string;
  /**
   * Override the body's `stream` flag. Pass `false` for a single JSON response
   * that's easy to read when replayed by hand. Omit to keep the body as captured.
   */
  stream?: boolean;
  /**
   * Pretty-print the JSON body (2-space indent) so the command is easy to read.
   * Single quotes preserve the newlines, so it stays runnable. Default `true`;
   * set `false` for a compact one-liner (handy for scripting or `-d @file`).
   */
  pretty?: boolean;
}

/**
 * Render a captured request body as a runnable `curl` command.
 *
 * @param body - The request body as POSTed (a {@link RawRequest}'s `body`).
 * @param options - Endpoint URL, API-key env var, and an optional `stream` override.
 * @returns A multi-line `curl` string with the key referenced as `$<apiKeyEnv>`.
 * @group Observability
 */
export function toCurl(body: unknown, options: ToCurlOptions): string {
  const { baseURL, path = "/chat/completions", apiKeyEnv = "API_KEY", stream, pretty = true } = options;
  const payload = stream === undefined ? body : { ...(body as object), stream };
  const json = JSON.stringify(payload, null, pretty ? 2 : undefined);
  const url = `${baseURL.replace(/\/+$/, "")}${path}`;
  return [
    `curl -N ${url} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "Authorization: Bearer $${apiKeyEnv}" \\`,
    `  -d ${shellSingleQuote(json)}`,
  ].join("\n");
}

/**
 * Wrap a string in shell single quotes, escaping any embedded single quote as
 * `'\''` — the safe way to pass an arbitrary JSON payload as one `curl` argument
 * (message content often contains apostrophes).
 *
 * @internal
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
