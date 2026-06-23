/**
 * `withCredentials` — wrap a Tool so the model can reference secrets by
 * placeholder (`{{name}}`) without ever seeing their values.
 *
 * @remarks
 * A composition decorator in the `with*` family (see `../compose`); stack it
 * with the permission gate and other wrappers.
 *
 * - inbound — the validated args are deep-walked and every `{{name}}` resolved
 *   against the {@link CredentialStore} just before `execute` runs, so the real
 *   value is live only for that one call.
 * - outbound — `ToolResult.content` and any thrown error message are scrubbed of
 *   the values resolved during the call, so an echoing command can't leak the
 *   secret back into the conversation.
 *
 * Transparent when args carry no placeholders: nothing is resolved, nothing is
 * scrubbed, behavior is identical to the bare tool.
 *
 * @module
 */

import type { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../tools/tools.types";
import type { CredentialStore } from "./credentials.types";
import { scrubSecrets, substituteCredentials } from "./substitute";

/**
 * Wrap a {@link Tool} so `{{name}}` placeholders in its args are resolved from a
 * {@link CredentialStore} and scrubbed back out of its output.
 *
 * @remarks
 * The real secret is live only for the duration of one `execute` call. Both the
 * result content and any thrown error message are scrubbed before they reach the
 * loop, so an echoing command cannot leak a secret into the conversation.
 *
 * Transparent when args carry no placeholders: behavior is identical to the bare
 * tool. The wrapped tool's name, description, and schema are preserved.
 *
 * @typeParam S - The Zod schema type of the tool's arguments.
 * @param tool - The tool to wrap.
 * @param store - The {@link CredentialStore} that resolves placeholder names.
 * @returns A tool with the same shape whose `execute` substitutes and scrubs.
 * @throws `Error` (re-thrown, scrubbed) if the inner tool throws, or if a
 *   referenced credential name is unknown.
 *
 * @example
 * ```ts
 * const store = new InMemoryCredentialStore({
 *   secrets: { github_token: process.env.GITHUB_TOKEN ?? "" },
 * });
 * const safeFetch = withCredentials(fetchTool, store);
 * // The model passes { header: "Bearer {{github_token}}" }; the real token is
 * // spliced in for the call and scrubbed from any echoed output.
 * ```
 *
 * @see {@link CredentialStore} for the resolution contract.
 * @see `substituteCredentials` and `scrubSecrets` (in `./substitute`) for the
 *   underlying primitives.
 * @group Credentials
 */
export function withCredentials<S extends z.ZodType>(
  tool: Tool<S>,
  store: CredentialStore,
): Tool<S> {
  return {
    ...tool,
    async execute(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult> {
      const { value, resolved } = await substituteCredentials(args, store);
      try {
        const result = await tool.execute(value as z.infer<S>, ctx);
        return { ...result, content: scrubSecrets(result.content, resolved) };
      } catch (error) {
        // Scrub before re-throwing: the loop folds this message into an error
        // tool-result the model sees, so a leaked secret would land in context.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(scrubSecrets(message, resolved));
      }
    },
  };
}
