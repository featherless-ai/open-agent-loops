/**
 * `permissionGate` — turns a PermissionStore + ApprovalPrompter into a
 * `gateToolCalls` hook (pass the result as `hooks.gateToolCalls`). Per call:
 * consult the store; "allow"/"deny" decide silently; "ask" prompts the user, and
 * "always" choices are persisted back to the store so the next run — even a
 * fresh process reading a JSON-file store — won't ask again.
 *
 * Composition over inheritance: a function over two interfaces, not a base
 * class. The whole "ask" subset is sent to the prompter in one round-trip, so a
 * CLI can present every pending approval at once.
 */

import type { GateDecision, ToolGateRequest } from "../primitives/loop";
import type { ApprovalChoice, ApprovalPrompter, PermissionStore } from "./permissions.types";

export function permissionGate(
  store: PermissionStore,
  prompter: ApprovalPrompter,
): (batch: ToolGateRequest[]) => Promise<GateDecision[]> {
  return async (batch) => {
    const policies = await Promise.all(
      batch.map((req) => store.get(req.toolCall.function.name, req.args)),
    );

    // Collect the calls that need a prompt, then ask about them all at once.
    const askIndices = policies.flatMap((policy, i) => (policy === "ask" ? [i] : []));
    const choices = askIndices.length
      ? await prompter.ask(
          askIndices.map((i) => ({ toolCall: batch[i]!.toolCall, args: batch[i]!.args })),
        )
      : [];
    const choiceByIndex = new Map(askIndices.map((i, k) => [i, choices[k]]));

    const decisions: GateDecision[] = [];
    for (let i = 0; i < batch.length; i += 1) {
      const policy = policies[i]!;
      if (policy === "allow") {
        decisions.push({ allow: true });
        continue;
      }
      if (policy === "deny") {
        decisions.push({ allow: false, reason: "Denied by saved permission" });
        continue;
      }

      // policy === "ask": apply the user's choice, persisting "always" ones.
      const choice: ApprovalChoice = choiceByIndex.get(i) ?? "deny_once";
      const name = batch[i]!.toolCall.function.name;
      if (choice === "allow_always") await store.set(name, "allow");
      if (choice === "deny_always") await store.set(name, "deny");
      const allow = choice === "allow_once" || choice === "allow_always";
      decisions.push(allow ? { allow: true } : { allow: false, reason: "Denied by user" });
    }
    return decisions;
  };
}
