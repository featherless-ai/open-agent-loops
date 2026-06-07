/**
 * The permission seam — a configurable allow/deny/ask policy for tool calls,
 * layered on the loop's `gateToolCalls` hook (see {@link permissionGate}).
 *
 * @remarks
 * Two sub-seams compose it, each a plain interface so a CLI, a UI, or a test
 * double can satisfy it:
 * - {@link PermissionStore} — reads the configured policy, persists "always"
 *   choices.
 * - {@link ApprovalPrompter} — asks the user when the policy is "ask".
 *
 * @module
 */

import type { ToolCall } from "../types";

/**
 * A configured policy for a tool: allow silently, deny silently, or ask.
 *
 * @group Permissions
 */
export enum PermissionPolicy {
  /** Run the tool silently, without prompting. */
  Allow = "allow",
  /** Block the tool silently, without prompting. */
  Deny = "deny",
  /** Prompt the user before running (see {@link ApprovalPrompter}). */
  Ask = "ask",
}

/**
 * The configuration the gate consults.
 *
 * @remarks
 * Reads the policy for a tool and persists durable ("always") decisions. Back it
 * with RAM, a JSON file (CLI), or a DB — the gate only depends on this
 * interface.
 *
 * @see {@link InMemoryPermissionStore} for the v1 RAM-backed implementation.
 * @see {@link permissionGate} for the consumer of this interface.
 * @group Permissions
 */
export interface PermissionStore {
  /**
   * Current policy for a call.
   *
   * @param toolName - The name of the tool being called.
   * @param args - The call's arguments, passed so rules can be arg-aware.
   * @returns The {@link PermissionPolicy} to apply to this call.
   */
  get(toolName: string, args: unknown): Promise<PermissionPolicy>;
  /**
   * Persist a durable decision — the "always" half of an approval choice.
   *
   * @param toolName - The name of the tool the decision applies to.
   * @param policy - The durable policy to store ({@link PermissionPolicy.Allow}
   *   or {@link PermissionPolicy.Deny}).
   */
  set(toolName: string, policy: PermissionPolicy.Allow | PermissionPolicy.Deny): Promise<void>;
}

/**
 * What the user picked when prompted: scoped to this call, or remembered.
 *
 * @group Permissions
 */
export enum ApprovalChoice {
  /** Allow this call only; do not persist. */
  AllowOnce = "allow_once",
  /** Allow this call and persist an "allow" policy for the tool. */
  AllowAlways = "allow_always",
  /** Deny this call only; do not persist. */
  DenyOnce = "deny_once",
  /** Deny this call and persist a "deny" policy for the tool. */
  DenyAlways = "deny_always",
}

/**
 * One call the user is being asked to approve.
 *
 * @group Permissions
 */
export interface ApprovalRequest {
  /** The pending tool call awaiting a decision. */
  toolCall: ToolCall;
  /** The call's arguments, for display to the user. */
  args: unknown;
}

/**
 * Asks the user to approve calls whose policy is "ask".
 *
 * @remarks
 * Receives the whole pending subset at once (one round-trip), so a CLI can
 * present them together.
 *
 * @see {@link permissionGate} for the consumer that batches "ask" calls.
 * @group Permissions
 */
export interface ApprovalPrompter {
  /**
   * Prompt the user for a decision on each pending call.
   *
   * @param batch - The pending {@link ApprovalRequest}s, all calls whose policy
   *   resolved to {@link PermissionPolicy.Ask}.
   * @returns One {@link ApprovalChoice} per request, index-aligned with `batch`.
   */
  ask(batch: ApprovalRequest[]): Promise<ApprovalChoice[]>;
}
