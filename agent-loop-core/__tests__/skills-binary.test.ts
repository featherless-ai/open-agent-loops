import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { shellTool } from "../tools/builtin/shell";
import { withCredentials } from "../credentials/with-credentials";
import { InMemoryCredentialStore } from "../credentials/in-memory-credential-store";
import { bunShellBackend } from "../../bun-backends";

// Run the real `secret-hello` binary that ships with the examples.
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(HERE, "../../examples/bin");
const KEY = "s3cr3t-hello-key";

// A real shell tool that runs commands in examples/bin, wrapped so `{{name}}`
// placeholders in the command are swapped for the real secret at execution time
// and scrubbed back out of the result — the placeholder-swap credential path.
function makeCredentialedShell() {
  const store = new InMemoryCredentialStore({ secrets: { secret_hello_token: KEY } });
  return withCredentials(shellTool(bunShellBackend({ cwd: BIN_DIR })), store);
}

describe("credential-gated binary skill (secret-hello)", () => {
  // Base case: the placeholder is swapped in, the binary accepts the credential
  // and greets — and the real key never appears in the result the model sees.
  test("base: the right credential unlocks the binary, and the token never leaks", async () => {
    const shell = makeCredentialedShell();
    const result = await shell.execute(
      { command: "SECRET_HELLO_TOKEN={{secret_hello_token}} ./secret-hello Ada" },
      { toolCallId: "t1" },
    );
    expect(result.content).toContain("Hello, Ada! (credential accepted)");
    expect(result.content).not.toContain(KEY); // scrubbed back out
  });

  // Edge: no credential in the command → the binary refuses and exits non-zero.
  // Proof the credential is doing real work, not decoration.
  test("edge: without the credential the binary refuses access", async () => {
    const shell = makeCredentialedShell();
    const result = await shell.execute(
      { command: "./secret-hello Ada" },
      { toolCallId: "t2" },
    );
    expect(result.content).toContain("unauthorized");
    expect(result.content).toContain("[exit code: 1]");
  });
});
