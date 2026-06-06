import { describe, expect, test } from "bun:test";
import { all, any, maxSteps, not, whenToolCalled } from "../stop";
import type { StopContext } from "../stop";
import type { Message } from "../types";

/** Build a StopContext with sensible defaults for pure-function testing. */
const ctx = (over: Partial<StopContext> = {}): StopContext => ({
  step: 1,
  assistant: { role: "assistant", content: "" } as Message,
  toolResults: [],
  messages: [],
  ...over,
});

const yes = () => true;
const no = () => false;

describe("maxSteps", () => {
  // Base case: stops once the step count reaches the limit.
  test("base: true at the limit", async () => {
    expect(await maxSteps(3)(ctx({ step: 3 }))).toBe(true);
  });
  // Edge: keeps going below the limit.
  test("edge: false below the limit", async () => {
    expect(await maxSteps(3)(ctx({ step: 2 }))).toBe(false);
  });
});

describe("whenToolCalled", () => {
  // Base case: true when the named tool produced a result this turn.
  test("base: true when the tool ran", async () => {
    const result = { role: "tool", content: "", toolName: "search" } as Message;
    expect(await whenToolCalled("search")(ctx({ toolResults: [result] }))).toBe(true);
  });
  // Edge: false when a different tool ran.
  test("edge: false for a different tool", async () => {
    const result = { role: "tool", content: "", toolName: "other" } as Message;
    expect(await whenToolCalled("search")(ctx({ toolResults: [result] }))).toBe(false);
  });
});

describe("any / all / not (composition)", () => {
  // any: true if at least one condition is true.
  test("base: any is true when one is true", async () => {
    expect(await any(no, yes, no)(ctx())).toBe(true);
  });
  // Edge: any of nothing is false.
  test("edge: any of none is false", async () => {
    expect(await any()(ctx())).toBe(false);
  });
  // all: true only when every condition is true.
  test("base: all is true when every condition holds", async () => {
    expect(await all(yes, yes)(ctx())).toBe(true);
  });
  // Edge: all is false if any condition fails.
  test("edge: all is false when one fails", async () => {
    expect(await all(yes, no)(ctx())).toBe(false);
  });
  // Edge: all of none is false (never stops on its own).
  test("edge: all of none is false", async () => {
    expect(await all()(ctx())).toBe(false);
  });
  // not: inverts the wrapped condition.
  test("edge: not inverts", async () => {
    expect(await not(yes)(ctx())).toBe(false);
    expect(await not(no)(ctx())).toBe(true);
  });
  // Conditions compose: stop when (maxSteps AND not toolCalled).
  test("edge: combinators nest", async () => {
    const cond = all(maxSteps(2), not(whenToolCalled("x")));
    expect(await cond(ctx({ step: 2, toolResults: [] }))).toBe(true);
    const withTool = ctx({ step: 2, toolResults: [{ role: "tool", content: "", toolName: "x" } as Message] });
    expect(await cond(withTool)).toBe(false);
  });
});
