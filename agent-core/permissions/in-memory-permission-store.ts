/**
 * `InMemoryPermissionStore` — the v1 {@link PermissionStore} (interface in
 * `./permissions.types`).
 *
 * @remarks
 * Holds policies in a Map: a `fallback` for tools with no rule yet
 * (default "ask"), seeded with any `rules` you pass — the entry point for
 * reading tool permissions from config. "always" choices are written back here.
 *
 * Like `SessionMemoryStore` it is RAM-only and gone on restart; a durable CLI
 * store (e.g. a JSON file under the user's config dir) implements the same
 * interface.
 *
 * @module
 */

import type { PermissionStore } from "./permissions.types";
import { PermissionPolicy } from "./permissions.types";

/**
 * A policy that can be *seeded* into a store: a concrete decision, never
 * {@link PermissionPolicy.Ask}.
 *
 * @remarks
 * Seed rules express settled choices; "ask" is the absence of a rule (the
 * fallback), so it is excluded here.
 *
 * @group Permissions
 */
export type SettablePolicy = PermissionPolicy.Allow | PermissionPolicy.Deny;

/**
 * Options for {@link InMemoryPermissionStore}.
 *
 * @group Permissions
 */
export interface InMemoryPermissionStoreOptions {
  /** Policy for tools without an explicit rule. Default "ask". */
  fallback?: PermissionPolicy;
  /** Preconfigured per-tool policies, e.g. loaded from a config file. */
  rules?: Record<string, SettablePolicy>;
}

/**
 * RAM-backed {@link PermissionStore} with a fallback policy and seeded rules.
 *
 * @remarks
 * Policies live in process memory and are lost on restart. Durable "always"
 * choices made through {@link permissionGate} are written back via
 * {@link InMemoryPermissionStore.set}.
 *
 * @example
 * ```ts
 * const store = new InMemoryPermissionStore({
 *   fallback: PermissionPolicy.Ask,
 *   rules: { read_file: PermissionPolicy.Allow },
 * });
 * await store.get("read_file", {}); // -> PermissionPolicy.Allow
 * await store.get("delete_file", {}); // -> PermissionPolicy.Ask (fallback)
 * ```
 *
 * @see {@link PermissionStore} for the interface contract.
 * @see {@link permissionGate} for the hook that consumes this store.
 * @group Permissions
 */
export class InMemoryPermissionStore implements PermissionStore {
  private readonly fallback: PermissionPolicy;
  private readonly rules: Map<string, SettablePolicy>;

  /**
   * Create a store with the given fallback and seeded rules.
   *
   * @param options - Fallback policy and seed rules; see
   *   {@link InMemoryPermissionStoreOptions}.
   */
  constructor(options: InMemoryPermissionStoreOptions = {}) {
    this.fallback = options.fallback ?? PermissionPolicy.Ask;
    this.rules = new Map(Object.entries(options.rules ?? {}));
  }

  /**
   * Return the policy for a tool, falling back to the configured default.
   *
   * @param toolName - The name of the tool being called.
   * @param _args - The call's arguments (unused; accepted for interface parity).
   * @returns The seeded rule for `toolName`, or the fallback policy.
   */
  async get(toolName: string, _args?: unknown): Promise<PermissionPolicy> {
    return this.rules.get(toolName) ?? this.fallback;
  }

  /**
   * Persist a durable allow/deny policy for a tool.
   *
   * @param toolName - The name of the tool the decision applies to.
   * @param policy - The durable policy to store.
   */
  async set(toolName: string, policy: SettablePolicy): Promise<void> {
    this.rules.set(toolName, policy);
  }
}
