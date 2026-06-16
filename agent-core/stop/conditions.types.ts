/**
 * The stop-condition seam for the agent loop.
 *
 * @remarks
 * Stop conditions decide when the loop should end early, independent of the
 * natural stop (the model produces a turn with no tool calls) and the hard
 * `maxSteps` safety cap. They compose, so callers can mix several — see the
 * combinators in `./conditions`.
 *
 * @module
 */

import type { AssistantMessage, Message, ToolMessage } from "../types";

/**
 * The per-turn snapshot passed to every {@link StopCondition}.
 *
 * @see {@link StopCondition}
 * @group Stop Conditions
 */
export interface StopContext {
  /** 1-based count of model turns taken so far in this run. */
  step: number;
  /** The assistant message produced this turn. */
  assistant: AssistantMessage;
  /** Tool-result messages produced this turn (empty if no tools ran). */
  toolResults: ToolMessage[];
  /** Full working history at this point. */
  messages: Message[];
}

/**
 * A predicate that decides whether the loop should stop after the current turn.
 *
 * @remarks
 * Returns (or resolves to) `true` to stop, `false` to continue. Conditions may
 * be sync or async. Compose them with the {@link any}, {@link all}, and
 * {@link not} combinators.
 *
 * @param ctx - The per-turn snapshot of loop state.
 * @returns `true` to stop the loop, `false` to continue.
 * @see {@link StopContext}
 * @group Stop Conditions
 */
export type StopCondition = (ctx: StopContext) => boolean | Promise<boolean>;
