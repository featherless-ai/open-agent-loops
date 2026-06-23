/**
 * The *outer* loop — "loop engineering". Where {@link runAgent} is the inner loop
 * (a model using tools in a loop until a natural final answer), {@link runGoal}
 * is the loop *around* it: run a full inner run, grade the result against a goal,
 * and if it falls short feed the grader's feedback back in as the next round's
 * prompt — until the goal is met or a round cap is hit.
 *
 * One run:
 *   [ runAgent -> grade ]* -> done (grade says so) | exhausted (round cap)
 *
 * Every round reuses the same `sessionId`, so each inner run loads the prior
 * rounds' history from {@link Memory} and continues the same conversation. The
 * grader is a seam ({@link Grader}); supply a plain function, or build one from a
 * fast model with `modelGrader` from `./model-grader`.
 *
 * @see {@link runGoal}
 * @module
 */

import { runAgent } from "../primitives/loop";
import type { Grade, GoalResult, RunFn, RunGoalOptions } from "./goal.types";

/**
 * Pursue a goal across rounds, driving {@link runAgent} until a {@link Grader}
 * is satisfied or the round cap is reached.
 *
 * @remarks
 * Each round is one full inner run. After it settles the grader judges it: a
 * `done` verdict ends the loop with {@link GoalResult.done | done} `true`; a
 * not-done verdict re-prompts the next round with the grader's `feedback` (or the
 * goal restated when no feedback is given). Hitting
 * {@link RunGoalOptions.maxRounds | maxRounds} ends the loop with `done` `false`.
 *
 * The {@link RunGoalOptions.signal | signal} is forwarded to each inner run and
 * re-checked at the top of every round, so cancellation unwinds promptly — an
 * abort mid-round rejects that inner run, and an abort between rounds rejects
 * `runGoal` before the next round starts.
 *
 * @param options - The goal, grader, shared run config, and loop configuration.
 * @returns Whether the goal was met, the round count, and the final grade/result.
 * @throws The {@link RunGoalOptions.signal | signal}'s reason (an AbortError) if
 *   the run is cancelled.
 * @example
 * ```ts
 * const outcome = await runGoal({
 *   goal: "Produce a one-paragraph summary with no spelling mistakes.",
 *   grader: modelGrader({ model: fastModel }),
 *   base: { model, memory: new SessionMemoryStore(), sessionId: "demo", tools },
 * });
 * console.log(outcome.done, outcome.rounds); // -> true 2
 * ```
 * @see {@link RunGoalOptions}
 * @see {@link GoalResult}
 * @group Goal Loop
 */
export async function runGoal(options: RunGoalOptions): Promise<GoalResult> {
  const { goal, grader, base, maxRounds = 5, signal, onRound } = options;
  const run: RunFn = options.run ?? runAgent;

  // First round starts from the explicit prompt, or the goal restated.
  let prompt = options.prompt ?? goal;
  let round = 0;
  let result!: GoalResult["result"];
  let grade!: Grade;

  while (true) {
    // Stop promptly on abort *between* rounds — before spending another inner
    // run. An abort *during* a round rejects that run via the forwarded signal.
    signal?.throwIfAborted();
    round += 1;

    result = await run({ ...base, prompt, signal });
    grade = await grader({ goal, round, result, signal });
    await onRound?.({ round, grade, result });

    if (grade.done) break;
    // Safety cap last, so the round that just ran still counts and is returned.
    if (round >= maxRounds) break;

    // Re-prompt with the grader's redirect; fall back to the goal restated.
    prompt = grade.feedback ?? goal;
  }

  return { done: grade.done, rounds: round, grade, result };
}
