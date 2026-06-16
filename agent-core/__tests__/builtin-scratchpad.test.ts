import { describe, expect, test } from "bun:test";
import {
  InMemoryScratchpad,
  scratchpadTools,
} from "../tools/builtin/scratchpad";
import { toToolSpec } from "../tools/tools";
import { ExecutionMode } from "../tools/tools.types";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import { Role } from "../types";

const ctx = { toolCallId: "c1" };

/** Resolve the two tools by name for clearer test bodies. */
function tools(scratchpad = new InMemoryScratchpad()) {
  const [read, write] = scratchpadTools(scratchpad);
  return { read: read!, write: write!, scratchpad };
}

describe("InMemoryScratchpad", () => {
  // Base case: a write is read back verbatim.
  test("base: write then read returns the stored content", () => {
    const pad = new InMemoryScratchpad();
    pad.write("my plan");
    expect(pad.read()).toBe("my plan");
  });

  // Edge: an untouched pad reads as a clear placeholder, not a blank.
  test("edge: an empty pad reads as (empty)", () => {
    expect(new InMemoryScratchpad().read()).toBe("(empty)");
  });

  // Edge: surrounding whitespace is trimmed on write.
  test("edge: write trims surrounding whitespace", () => {
    const pad = new InMemoryScratchpad();
    pad.write("  spaced  \n");
    expect(pad.read()).toBe("spaced");
  });

  // Edge: each write fully replaces the previous content.
  test("edge: write replaces the previous content", () => {
    const pad = new InMemoryScratchpad();
    pad.write("first");
    pad.write("second");
    expect(pad.read()).toBe("second");
  });
});

describe("scratchpadTools", () => {
  // Base case: the write tool persists into the backing store and confirms.
  test("base: write_scratchpad stores content and confirms", () => {
    const { write, scratchpad } = tools();
    const result = write.execute({ content: "remember this" } as never, ctx);
    expect(scratchpad.read()).toBe("remember this");
    expect((result as { content: string }).content).toBe("Saved to scratchpad.");
  });

  // Base case: the read tool returns the current store contents.
  test("base: read_scratchpad returns the stored content", () => {
    const { read, scratchpad } = tools();
    scratchpad.write("notes");
    expect((read.execute({} as never, ctx) as { content: string }).content).toBe("notes");
  });

  // Edge: both tools run sequentially — a read must not race a batched write.
  test("edge: both tools are sequential", () => {
    const { read, write } = tools();
    expect(read.executionMode).toBe(ExecutionMode.Sequential);
    expect(write.executionMode).toBe(ExecutionMode.Sequential);
  });

  // Edge: the model-facing specs advertise stable names + the write param.
  test("edge: toToolSpec advertises names and the content param", () => {
    const { read, write } = tools();
    expect(toToolSpec(read).name).toBe("read_scratchpad");
    const writeSpec = toToolSpec(write);
    expect(writeSpec.name).toBe("write_scratchpad");
    expect(Object.keys((writeSpec.parameters as any).properties)).toEqual(["content"]);
  });

  // Integration: a write in one turn is visible to a read in the next.
  test("integration: write then read across turns in runAgent", async () => {
    const scratchpad = new InMemoryScratchpad();
    const model = new MockModelClient([
      { toolCalls: [{ name: "write_scratchpad", arguments: { content: "the plan" } }] },
      { toolCalls: [{ name: "read_scratchpad", arguments: {} }] },
      { text: "done" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "plan then recall",
      tools: scratchpadTools(scratchpad),
    });

    const toolMessages = result.messages.filter((m) => m.role === Role.Tool);
    expect(toolMessages[0]?.content).toBe("Saved to scratchpad.");
    expect(toolMessages[1]?.content).toBe("the plan");
    expect(result.messages.at(-1)?.content).toBe("done");
  });
});
