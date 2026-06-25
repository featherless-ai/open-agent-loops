import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineTool } from "../tools/tools";
import type { ToolContext } from "../tools/tools.types";
import { InMemoryCredentialStore } from "../credentials/in-memory-credential-store";
import { scrubSecrets, substituteCredentials } from "../credentials/substitute";
import { withCredentials } from "../credentials/with-credentials";

const ctx: ToolContext = { toolCallId: "call-1" };

describe("InMemoryCredentialStore", () => {
  // Base case: a seeded name resolves to its secret value.
  test("base: resolves a seeded name", async () => {
    const store = new InMemoryCredentialStore({ secrets: { token: "s3cret" } });
    expect(await store.resolve("token")).toBe("s3cret");
  });

  // Unknown names resolve to undefined (not an error at the store layer).
  test("unknown name resolves to undefined", async () => {
    const store = new InMemoryCredentialStore({ secrets: { token: "s3cret" } });
    expect(await store.resolve("missing")).toBeUndefined();
  });

  // Default construction yields an empty store.
  test("empty store resolves everything to undefined", async () => {
    const store = new InMemoryCredentialStore();
    expect(await store.resolve("token")).toBeUndefined();
  });
});

describe("substituteCredentials", () => {
  const store = new InMemoryCredentialStore({ secrets: { token: "s3cret", db: "pw" } });

  // Base case: a whole-string placeholder becomes the secret value.
  test("base: substitutes a standalone placeholder", async () => {
    const { value } = await substituteCredentials({ command: "{{token}}" }, store);
    expect(value).toEqual({ command: "s3cret" });
  });

  // Mid-string placeholders are spliced in place, not just whole values.
  test("substitutes a placeholder embedded mid-string", async () => {
    const { value } = await substituteCredentials(
      { command: "curl -H 'Authorization: Bearer {{token}}' url" },
      store,
    );
    expect(value).toEqual({ command: "curl -H 'Authorization: Bearer s3cret' url" });
  });

  // Nested objects and arrays are walked; non-string leaves pass through.
  test("walks nested objects/arrays and leaves non-strings untouched", async () => {
    const { value } = await substituteCredentials(
      { args: ["--user", "{{db}}"], retries: 3, verbose: true },
      store,
    );
    expect(value).toEqual({ args: ["--user", "pw"], retries: 3, verbose: true });
  });

  // The resolved map keys secret value -> placeholder name, for scrubbing.
  test("reports resolved value->name pairs", async () => {
    const { resolved } = await substituteCredentials({ a: "{{token}}", b: "{{db}}" }, store);
    expect(resolved.get("s3cret")).toBe("token");
    expect(resolved.get("pw")).toBe("db");
  });

  // Fail fast: an unknown placeholder throws a descriptive error.
  test("unknown placeholder throws", async () => {
    await expect(substituteCredentials({ command: "{{missing}}" }, store)).rejects.toThrow(
      /Unknown credential "missing"/,
    );
  });

  // No placeholders → structurally identical args, empty resolved map.
  test("passthrough when no placeholders present", async () => {
    const { value, resolved } = await substituteCredentials({ command: "ls -la" }, store);
    expect(value).toEqual({ command: "ls -la" });
    expect(resolved.size).toBe(0);
  });
});

describe("scrubSecrets", () => {
  // Base case: a leaked value is replaced by its placeholder.
  test("base: replaces a value with its placeholder", () => {
    const resolved = new Map([["s3cret", "token"]]);
    expect(scrubSecrets("the key is s3cret here", resolved)).toBe("the key is {{token}} here");
  });

  // Every occurrence is scrubbed, not just the first.
  test("scrubs all occurrences", () => {
    const resolved = new Map([["s3cret", "token"]]);
    expect(scrubSecrets("s3cret s3cret", resolved)).toBe("{{token}} {{token}}");
  });

  // An empty secret value is skipped (it would match everywhere).
  test("skips empty values", () => {
    const resolved = new Map([["", "blank"]]);
    expect(scrubSecrets("untouched", resolved)).toBe("untouched");
  });
});

describe("withCredentials", () => {
  const store = new InMemoryCredentialStore({ secrets: { token: "s3cret" } });
  const echoTool = (capture: { seen?: string }) =>
    defineTool({
      name: "echo",
      description: "echoes its command back",
      parameters: z.object({ command: z.string() }),
      execute: (args) => {
        capture.seen = args.command;
        return { content: `ran: ${args.command}` };
      },
    });

  // Metadata is preserved by the wrapper.
  test("preserves name, description, and schema", () => {
    const tool = echoTool({});
    const wrapped = withCredentials(tool, store);
    expect(wrapped.name).toBe("echo");
    expect(wrapped.description).toBe("echoes its command back");
    expect(wrapped.parameters).toBe(tool.parameters);
  });

  // The real secret reaches execute; the returned content is scrubbed.
  test("injects the real value into execute and scrubs the result", async () => {
    const capture: { seen?: string } = {};
    const wrapped = withCredentials(echoTool(capture), store);
    const result = await wrapped.execute({ command: "login {{token}}" }, ctx);
    expect(capture.seen).toBe("login s3cret"); // execute saw the real value
    expect(result.content).toBe("ran: login {{token}}"); // model sees the placeholder
  });

  // A thrown error that echoes the secret is scrubbed before propagating.
  test("scrubs the secret out of a thrown error message", async () => {
    const throwing = defineTool({
      name: "boom",
      description: "throws with the command in the message",
      parameters: z.object({ command: z.string() }),
      execute: (args) => {
        throw new Error(`failed running: ${args.command}`);
      },
    });
    const wrapped = withCredentials(throwing, store);
    await expect(wrapped.execute({ command: "{{token}}" }, ctx)).rejects.toThrow(
      "failed running: {{token}}",
    );
  });

  // With no placeholder the wrapper is transparent.
  test("passthrough when no placeholder is present", async () => {
    const capture: { seen?: string } = {};
    const wrapped = withCredentials(echoTool(capture), store);
    const result = await wrapped.execute({ command: "ls" }, ctx);
    expect(capture.seen).toBe("ls");
    expect(result.content).toBe("ran: ls");
  });
});
