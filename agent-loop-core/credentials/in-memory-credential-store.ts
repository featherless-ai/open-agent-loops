/**
 * `InMemoryCredentialStore` — the v1 {@link CredentialStore} (interface in
 * `./credentials.types`).
 *
 * @remarks
 * Holds `name -> secret` pairs in a Map, seeded from a record you pass in — the
 * entry point for loading credentials from the environment at startup
 * (e.g. `{ github_token: process.env.GITHUB_TOKEN }`).
 *
 * Like `SessionMemoryStore` / `InMemoryPermissionStore`, it is the RAM-only
 * battery for this seam — convenient, but gone on restart. Replace it with your
 * own: a durable or vault-backed store implements the same `resolve` interface.
 *
 * SECURITY: secrets live in plaintext in this process's memory. See
 * {@link CredentialStore} for the trust-boundary note.
 *
 * @module
 */

import type { CredentialStore } from "./credentials.types";

/**
 * Options for {@link InMemoryCredentialStore}.
 *
 * @group Credentials
 */
export interface InMemoryCredentialStoreOptions {
  /** Preconfigured `name -> secret` pairs, e.g. read from env at startup. */
  secrets?: Record<string, string>;
}

/**
 * RAM-backed {@link CredentialStore} seeded from a record of secrets.
 *
 * @remarks
 * SECURITY: secrets are kept in plaintext in process memory and are lost on
 * restart. Treat the instance as a trust boundary — only hand it to tools that
 * are meant to receive real credentials.
 *
 * @example
 * ```ts
 * const store = new InMemoryCredentialStore({
 *   secrets: { github_token: process.env.GITHUB_TOKEN ?? "" },
 * });
 * const token = await store.resolve("github_token");
 * ```
 *
 * @see {@link CredentialStore} for the interface contract.
 * @see {@link withCredentials} for wrapping a tool with this store.
 * @group Credentials
 */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly secrets: Map<string, string>;

  /**
   * Create a store seeded with the given secrets.
   *
   * @param options - Seed secrets; see {@link InMemoryCredentialStoreOptions}.
   */
  constructor(options: InMemoryCredentialStoreOptions = {}) {
    this.secrets = new Map(Object.entries(options.secrets ?? {}));
  }

  /**
   * Resolve a placeholder name to its seeded secret value.
   *
   * @param name - The placeholder name to resolve.
   * @returns The secret value, or `undefined` if no such credential was seeded.
   */
  async resolve(name: string): Promise<string | undefined> {
    return this.secrets.get(name);
  }
}
