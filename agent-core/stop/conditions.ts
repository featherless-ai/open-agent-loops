/**
 * Built-in stop conditions and combinators for the stop seam.
 *
 * @remarks
 * The seam interface lives in `./conditions.types`. Conditions decide when the
 * loop should end early, independent of the natural stop (the model produces a
 * turn with no tool calls) and the hard `maxSteps` safety cap. They compose, so
 * callers can mix several with {@link any} / {@link all} / {@link not}.
 *
 * @module
 */

import type { StopCondition } from "./conditions.types";

/**
 * Build a condition that stops once `step` reaches `n` turns.
 *
 * @param n - The turn count at which to stop (uses the 1-based `ctx.step`).
 * @returns A {@link StopCondition} that fires when `ctx.step >= n`.
 * @example
 * ```ts
 * // Stop after at most 5 model turns.
 * const stop = maxSteps(5);
 * ```
 * @see {@link StopCondition}
 * @group Stop Conditions
 */
export function maxSteps(n: number): StopCondition {
  return (ctx) => ctx.step >= n;
}

/**
 * Build a condition that stops as soon as a specific tool has been called this
 * turn.
 *
 * @param toolName - The name of the tool to watch for in this turn's results.
 * @returns A {@link StopCondition} that fires when `toolName` appears in
 * `ctx.toolResults`.
 * @example
 * ```ts
 * // Stop the run the moment the model calls the "submit_answer" tool.
 * const stop = whenToolCalled("submit_answer");
 * ```
 * @see {@link StopContext}
 * @group Stop Conditions
 */
export function whenToolCalled(toolName: string): StopCondition {
  return (ctx) =>
    ctx.toolResults.some((result) => result.toolName === toolName);
}

/**
 * Combine conditions: stop if ANY of them say so.
 *
 * @remarks
 * Conditions are evaluated in order and short-circuits on the first `true`.
 * An empty list never stops.
 *
 * @param conditions - The conditions to OR together.
 * @returns A {@link StopCondition} that fires when at least one input fires.
 * @example
 * ```ts
 * const stop = any(maxSteps(10), whenToolCalled("submit_answer"));
 * ```
 * @see {@link all}
 * @see {@link not}
 * @group Stop Conditions
 */
export function any(...conditions: StopCondition[]): StopCondition {
  return async (ctx) => {
    for (const condition of conditions) {
      if (await condition(ctx)) return true;
    }
    return false;
  };
}

/**
 * Combine conditions: stop only if ALL of them say so.
 *
 * @remarks
 * Conditions are evaluated in order and short-circuits on the first `false`.
 * An empty list never stops.
 *
 * @param conditions - The conditions to AND together.
 * @returns A {@link StopCondition} that fires only when every input fires
 * (and the list is non-empty).
 * @example
 * ```ts
 * // Stop only once we are past step 3 AND the tool has been called.
 * const stop = all(maxSteps(3), whenToolCalled("submit_answer"));
 * ```
 * @see {@link any}
 * @see {@link not}
 * @group Stop Conditions
 */
export function all(...conditions: StopCondition[]): StopCondition {
  return async (ctx) => {
    for (const condition of conditions) {
      if (!(await condition(ctx))) return false;
    }
    return conditions.length > 0;
  };
}

/**
 * Invert a condition.
 *
 * @param condition - The condition to negate.
 * @returns A {@link StopCondition} that fires exactly when `condition` does not.
 * @example
 * ```ts
 * // Continue (do not stop) until the tool has been called.
 * const keepGoing = not(whenToolCalled("submit_answer"));
 * ```
 * @see {@link any}
 * @see {@link all}
 * @group Stop Conditions
 */
export function not(condition: StopCondition): StopCondition {
  return async (ctx) => !(await condition(ctx));
}
