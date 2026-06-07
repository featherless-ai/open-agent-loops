/**
 * Built-in stop conditions and combinators for the stop seam (interface in
 * `./conditions.types`). Conditions decide when the loop should end early,
 * independent of the natural stop (the model produces a turn with no tool
 * calls) and the hard `maxSteps` safety cap. They compose, so callers can mix
 * several with `any` / `all` / `not`.
 */

import type { StopCondition } from "./conditions.types";

/** Stop once `step` reaches `n` turns. */
export function maxSteps(n: number): StopCondition {
  return (ctx) => ctx.step >= n;
}

/** Stop as soon as a specific tool has been called this turn. */
export function whenToolCalled(toolName: string): StopCondition {
  return (ctx) =>
    ctx.toolResults.some((result) => result.toolName === toolName);
}

/** Combine conditions: stop if ANY of them say so. */
export function any(...conditions: StopCondition[]): StopCondition {
  return async (ctx) => {
    for (const condition of conditions) {
      if (await condition(ctx)) return true;
    }
    return false;
  };
}

/** Combine conditions: stop only if ALL of them say so (empty = never). */
export function all(...conditions: StopCondition[]): StopCondition {
  return async (ctx) => {
    for (const condition of conditions) {
      if (!(await condition(ctx))) return false;
    }
    return conditions.length > 0;
  };
}

/** Invert a condition. */
export function not(condition: StopCondition): StopCondition {
  return async (ctx) => !(await condition(ctx));
}
