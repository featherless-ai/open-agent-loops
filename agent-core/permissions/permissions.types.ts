/**
 * The permission seam — a configurable allow/deny/ask policy for tool calls,
 * layered on the loop's `gateToolCalls` hook (see `./permission-gate`). Two
 * sub-seams compose it, each a plain interface so a CLI, a UI, or a test double
 * can satisfy it:
 *   PermissionStore   - reads the configured policy, persists "always" choices
 *   ApprovalPrompter  - asks the user when the policy is "ask"
 */

import type { ToolCall } from "../types";

/** A configured policy for a tool: allow silently, deny silently, or ask. */
export enum PermissionPolicy {
  Allow = "allow",
  Deny = "deny",
  Ask = "ask",
}

/**
 * The configuration the gate consults. Reads the policy for a tool and persists
 * durable ("always") decisions. Back it with RAM, a JSON file (CLI), or a DB —
 * the gate only depends on this interface.
 */
export interface PermissionStore {
  /** Current policy for a call. `args` is passed so rules can be arg-aware. */
  get(toolName: string, args: unknown): Promise<PermissionPolicy>;
  /** Persist a durable decision — the "always" half of an approval choice. */
  set(toolName: string, policy: PermissionPolicy.Allow | PermissionPolicy.Deny): Promise<void>;
}

/** What the user picked when prompted: scoped to this call, or remembered. */
export enum ApprovalChoice {
  AllowOnce = "allow_once",
  AllowAlways = "allow_always",
  DenyOnce = "deny_once",
  DenyAlways = "deny_always",
}

/** One call the user is being asked to approve. */
export interface ApprovalRequest {
  toolCall: ToolCall;
  args: unknown;
}

/**
 * Asks the user to approve calls whose policy is "ask". Receives the whole
 * pending subset at once (one round-trip), so a CLI can present them together.
 */
export interface ApprovalPrompter {
  /** Return one choice per request, index-aligned. */
  ask(batch: ApprovalRequest[]): Promise<ApprovalChoice[]>;
}
