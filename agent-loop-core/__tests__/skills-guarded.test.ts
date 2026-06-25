import { describe, expect, test } from "bun:test";
import { isToolMessage } from "../types";
import { runAgent } from "../primitives/loop";
import { SessionMemoryStore } from "../memory/session-memory";
import { MockModelClient } from "../mocks/mock-model";
import { MockShellBackend } from "../mocks/mock-shell";
import { shellTool } from "../tools/builtin/shell";
import { withCredentials } from "../credentials/with-credentials";
import { InMemoryCredentialStore } from "../credentials/in-memory-credential-store";
import { permissionGate } from "../permissions/permission-gate";
import { InMemoryPermissionStore } from "../permissions/in-memory-permission-store";
import { ApprovalChoice, PermissionPolicy } from "../permissions/permissions.types";
import type { ApprovalPrompter, ApprovalRequest } from "../permissions/permissions.types";
import { SkillRegistry } from "../skills/registry";
import { skillTool } from "../skills/skill-tool";
import type { Skill } from "../skills/skills.types";

const KEY = "s3cr3t-hello-key";

const secretHelloSkill: Skill = {
  name: "secret-hello",
  description: "Greet a person using the access-controlled secret-hello CLI.",
  instructions: 'Run: SECRET_HELLO_TOKEN={{secret_hello_token}} ./secret-hello "<name>"',
};

// A prompter that records what it was shown, then answers with a fixed choice.
function scriptedPrompter(choice: ApprovalChoice) {
  const shown: ApprovalRequest[] = [];
  const prompter: ApprovalPrompter = {
    async ask(batch) {
      shown.push(...batch);
      return batch.map(() => choice);
    },
  };
  return { prompter, shown };
}

describe("guarded + credentialed skill (permissions AND credentials together)", () => {
  // The headline: a skill drives the shell; the call is gated AND credentialed.
  // The gate sees the placeholder; the backend sees the real secret; the model
  // sees a scrubbed result.
  test("gate sees the placeholder, the binary sees the real secret, output is scrubbed", async () => {
    const ranCommands: string[] = [];
    const backend = new MockShellBackend((command) => {
      ranCommands.push(command);
      return { stdout: "Hello, Ada! (credential accepted)", stderr: "", exitCode: 0 };
    });
    const shell = withCredentials(
      shellTool(backend),
      new InMemoryCredentialStore({ secrets: { secret_hello_token: KEY } }),
    );
    const skills = new SkillRegistry([secretHelloSkill]);
    const permissions = new InMemoryPermissionStore({
      fallback: PermissionPolicy.Ask,
      rules: { skill: PermissionPolicy.Allow }, // loading the skill never prompts
    });
    const { prompter, shown } = scriptedPrompter(ApprovalChoice.AllowOnce);

    const model = new MockModelClient([
      { toolCalls: [{ name: "skill", arguments: { name: "secret-hello" } }] },
      {
        toolCalls: [
          {
            name: "shell",
            arguments: { command: 'SECRET_HELLO_TOKEN={{secret_hello_token}} ./secret-hello "Ada"' },
          },
        ],
      },
      { text: "Hello, Ada! (credential accepted)" },
    ]);

    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "guarded",
      prompt: "Give Ada a secret hello.",
      system: `skills:\n${skills.catalog()}`,
      tools: [skillTool(skills), shell],
      hooks: { gateToolCalls: permissionGate(permissions, prompter) },
    });

    // Only the shell call prompted — loading the skill was pre-approved.
    expect(shown).toHaveLength(1);
    expect(shown[0]?.toolCall.function.name).toBe("shell");
    // The approval prompt showed the PLACEHOLDER, never the real secret.
    expect(JSON.stringify(shown[0]?.args)).toContain("{{secret_hello_token}}");
    expect(JSON.stringify(shown[0]?.args)).not.toContain(KEY);
    // The backend actually ran the command with the secret substituted in.
    expect(ranCommands).toHaveLength(1);
    expect(ranCommands[0]).toContain(KEY);
    expect(ranCommands[0]).not.toContain("{{secret_hello_token}}");
    // The model's final answer is present (and the result was scrubbed upstream).
    expect(result.messages.at(-1)?.content).toContain("Hello, Ada!");
  });

  // Denying the shell call blocks execution entirely (fail closed) — the
  // credential is never resolved because the command never runs.
  test("denying the call blocks the shell, and nothing executes", async () => {
    const backend = new MockShellBackend(() => ({ stdout: "should not run", stderr: "", exitCode: 0 }));
    const shell = withCredentials(
      shellTool(backend),
      new InMemoryCredentialStore({ secrets: { secret_hello_token: KEY } }),
    );
    const permissions = new InMemoryPermissionStore({ fallback: PermissionPolicy.Ask });
    const { prompter } = scriptedPrompter(ApprovalChoice.DenyOnce);

    const model = new MockModelClient([
      { toolCalls: [{ name: "shell", arguments: { command: "echo hi" } }] },
      { text: "understood" },
    ]);

    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "deny",
      prompt: "say hi to Ada",
      tools: [shell],
      hooks: { gateToolCalls: permissionGate(permissions, prompter) },
    });

    expect(backend.calls).toHaveLength(0); // never executed
    const toolResults = result.newMessages.filter(isToolMessage);
    expect(toolResults.some((m) => /denied/i.test(m.content))).toBe(true);
  });
});
