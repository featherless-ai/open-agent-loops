/**
 * Pure substitution + scrub primitives behind {@link withCredentials}.
 *
 * @remarks
 * Kept free of any Tool/loop coupling so they are directly testable.
 *
 * Placeholder syntax is `{{name}}` where `name` is `[A-Za-z0-9_.-]+`. Chosen so
 * it never collides with a shell's own `$VAR` expansion: the model writes
 * `{{token}}`, never the raw secret.
 *
 * - inbound — {@link substituteCredentials} deep-walks tool args, replacing
 *   every `{{name}}` (even mid-string, e.g. `Bearer {{token}}`) with the
 *   resolved secret. An unknown name fails fast.
 * - outbound — {@link scrubSecrets} replaces every literal occurrence of a
 *   resolved value with its `{{name}}`, so a command that echoes the secret
 *   (an error dump, `env`, ...) can't leak it back into the model.
 *
 * @module
 */

import type { CredentialStore } from "./credentials.types";

/**
 * `{{name}}`, with optional inner whitespace. Global, for matchAll/replace.
 *
 * @internal
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/**
 * The outcome of substituting credentials into tool args.
 *
 * @group Credentials
 */
export interface Substitution {
  /** Args with every `{{name}}` replaced by its resolved secret value. */
  value: unknown;
  /** Resolved `secretValue -> name`, for scrubbing the result afterward. */
  resolved: Map<string, string>;
}

/**
 * Deep-walk `args`, resolving every `{{name}}` against `store` and splicing the
 * real value in.
 *
 * @remarks
 * Each referenced name is resolved once. The returned `resolved` map inverts the
 * resolution (`secretValue -> name`) so the result can be scrubbed afterward
 * with {@link scrubSecrets}.
 *
 * @param args - Arbitrary tool arguments to deep-walk for placeholders.
 * @param store - The {@link CredentialStore} used to resolve each name.
 * @returns A {@link Substitution} with the spliced `value` and the inverse
 *   `resolved` map.
 * @throws `Error` on an unknown name (fail fast — the loop turns it into
 *   an error tool-result).
 *
 * @example
 * ```ts
 * const store = new InMemoryCredentialStore({ secrets: { token: "s3cr3t" } });
 * const { value, resolved } = await substituteCredentials(
 *   { header: "Bearer {{token}}" },
 *   store,
 * );
 * // value    -> { header: "Bearer s3cr3t" }
 * // resolved -> Map { "s3cr3t" => "token" }
 * ```
 *
 * @see {@link scrubSecrets} for the outbound counterpart.
 * @group Credentials
 */
export async function substituteCredentials(
  args: unknown,
  store: CredentialStore,
): Promise<Substitution> {
  const valueByName = new Map<string, string>();
  for (const name of collectNames(args)) {
    const secret = await store.resolve(name);
    if (secret === undefined) {
      throw new Error(`Unknown credential "${name}" referenced as {{${name}}}.`);
    }
    valueByName.set(name, secret);
  }

  const value = mapStrings(args, (s) =>
    s.replace(PLACEHOLDER, (_match, name: string) => valueByName.get(name) ?? _match),
  );

  const resolved = new Map<string, string>();
  for (const [name, secret] of valueByName) resolved.set(secret, name);
  return { value, resolved };
}

/**
 * Replace every literal occurrence of each resolved secret value in `text` with
 * its `{{name}}`.
 *
 * @remarks
 * Empty values are skipped (they would match everywhere). This is the outbound
 * defense that keeps an echoing command from leaking a secret back into the
 * conversation.
 *
 * @param text - The text to scrub (tool result content or an error message).
 * @param resolved - The `secretValue -> name` map from
 *   {@link substituteCredentials}.
 * @returns `text` with every resolved secret value replaced by its placeholder.
 *
 * @example
 * ```ts
 * const resolved = new Map([["s3cr3t", "token"]]);
 * scrubSecrets("echoed s3cr3t", resolved); // -> "echoed {{token}}"
 * ```
 *
 * @see {@link substituteCredentials} for the inbound counterpart.
 * @group Credentials
 */
export function scrubSecrets(text: string, resolved: Map<string, string>): string {
  let out = text;
  for (const [value, name] of resolved) {
    if (!value) continue;
    out = out.split(value).join(`{{${name}}}`);
  }
  return out;
}

/**
 * All placeholder names referenced by any string within `value`.
 *
 * @internal
 */
function collectNames(value: unknown): Set<string> {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(PLACEHOLDER)) names.add(match[1]);
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return names;
}

/**
 * Structurally clone `value`, transforming every string leaf with `fn`.
 *
 * @internal
 */
function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, mapStrings(val, fn)]),
    );
  }
  return value;
}
