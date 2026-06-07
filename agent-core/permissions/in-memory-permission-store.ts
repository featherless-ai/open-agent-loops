/**
 * `InMemoryPermissionStore` — the v1 PermissionStore (interface in
 * `./permissions.types`). Holds policies in a Map: a `fallback` for tools with
 * no rule yet (default "ask"), seeded with any `rules` you pass — the entry
 * point for reading tool permissions from config. "always" choices are written
 * back here. Like SessionMemoryStore it is RAM-only and gone on restart; a
 * durable CLI store (e.g. a JSON file under the user's config dir) implements
 * the same interface.
 */

import type { PermissionStore } from "./permissions.types";
import { PermissionPolicy } from "./permissions.types";

type SettablePolicy = PermissionPolicy.Allow | PermissionPolicy.Deny;

export interface InMemoryPermissionStoreOptions {
  /** Policy for tools without an explicit rule. Default "ask". */
  fallback?: PermissionPolicy;
  /** Preconfigured per-tool policies, e.g. loaded from a config file. */
  rules?: Record<string, SettablePolicy>;
}

export class InMemoryPermissionStore implements PermissionStore {
  private readonly fallback: PermissionPolicy;
  private readonly rules: Map<string, SettablePolicy>;

  constructor(options: InMemoryPermissionStoreOptions = {}) {
    this.fallback = options.fallback ?? PermissionPolicy.Ask;
    this.rules = new Map(Object.entries(options.rules ?? {}));
  }

  async get(toolName: string, _args?: unknown): Promise<PermissionPolicy> {
    return this.rules.get(toolName) ?? this.fallback;
  }

  async set(toolName: string, policy: SettablePolicy): Promise<void> {
    this.rules.set(toolName, policy);
  }
}
