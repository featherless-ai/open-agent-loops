/**
 * Types for {@link runGoal} — the *outer* loop that drives {@link runAgent}
 * across rounds until a goal is met.
 *
 * @remarks
 * The grader is a seam, exactly parallel to the stop-condition seam in `../stop`:
 * a plain function the caller supplies. The pure core takes any {@link Grader};
 * `../goal/model-grader` ships the battery that builds one from a `ModelClient`.
 *
 * @module
 */

import type { Message } from "../types";
import type { RunAgentOptions, RunResult } from "../primitives/loop";

/**
 * The per-round snapshot handed to a {@link Grader} after a round's inner run
 * settles.
 *
 * @see {@link Grader}
 * @group Goal Loop
 */
export interface GradeContext {
  /** The objective being pursued, verbatim. */
  goal: string;
  /** 1-based number of the round just completed. */
  round: number;
  /** The {@link runAgent} result of the round just completed. */
  result: RunResult;
  /**
   * The goal loop's cancel signal, forwarded so a grader that does its own I/O
   * (e.g. a model call) can honor it.
   */
  signal?: AbortSignal;
}

/**
 * A grader's verdict on one round.
 *
 * @group Goal Loop
 */
export interface Grade {
  /** `true` when the goal is satisfied — the loop stops with success. */
  done: boolean;
  /**
   * When not {@link Grade.done | done}, the prompt for the next round (the
   * redirect that tells the agent what to fix). Omitted → the next round
   * re-prompts with the goal restated.
   */
  feedback?: string;
  /** Optional numeric score, surfaced for observability; never gates the loop. */
  score?: number;
}

/**
 * Judges a round and decides whether the goal is met.
 *
 * @remarks
 * Parallels {@link StopCondition}: a function, sync or async, the caller owns.
 * Returning `{ done: true }` ends the loop; `{ done: false, feedback }` drives the
 * next round with `feedback` as the prompt.
 *
 * @param ctx - The round's snapshot.
 * @returns The {@link Grade} for this round.
 * @group Goal Loop
 */
export type Grader = (ctx: GradeContext) => Grade | Promise<Grade>;

/**
 * How {@link runGoal} executes one round. Defaults to {@link runAgent};
 * injectable so tests can drive it with a controllable fake instead of a model.
 *
 * @group Goal Loop
 */
export type RunFn = (options: RunAgentOptions) => Promise<RunResult>;

/**
 * The per-round run configuration shared across every round — everything
 * {@link runAgent} needs *except* the `prompt` (which `runGoal` re-prompts each
 * round) and the `signal` (which `runGoal` forwards). The `sessionId` lives here
 * and is reused for every round, so each round loads the prior rounds' history.
 *
 * @group Goal Loop
 */
export type RunGoalRunBase = Omit<RunAgentOptions, "prompt" | "signal">;

/**
 * Inputs for a single {@link runGoal} run.
 *
 * @group Goal Loop
 */
export interface RunGoalOptions {
  /** The objective, in natural language — handed to the grader each round. */
  goal: string;
  /** Judges each round and decides done-or-continue (and the next prompt). */
  grader: Grader;
  /** Shared per-round run config (model, memory, sessionId, tools, system, …). */
  base: RunGoalRunBase;
  /**
   * The first round's prompt. Omitted → the run starts from the {@link goal}
   * restated as the prompt.
   */
  prompt?: string | Message | Message[];
  /** Hard cap on outer rounds (each round is one full inner run). Default `5`. */
  maxRounds?: number;
  /** Override how each round runs (for tests). Default {@link runAgent}. */
  run?: RunFn;
  /**
   * Cancel the whole goal loop. Forwarded to each round's inner run and
   * re-checked at the top of each round, so an abort between rounds rejects
   * promptly instead of starting another round.
   */
  signal?: AbortSignal;
  /** Observe each round's verdict as it settles (for logging/telemetry). */
  onRound?: (info: { round: number; grade: Grade; result: RunResult }) => void | Promise<void>;
}

/**
 * The outcome of a {@link runGoal} run.
 *
 * @group Goal Loop
 */
export interface GoalResult {
  /**
   * Whether the goal was satisfied. `true` means the grader returned `done`
   * before the cap; `false` means {@link RunGoalOptions.maxRounds | maxRounds}
   * was reached without a `done` verdict.
   */
  done: boolean;
  /** Number of outer rounds run (each a full inner {@link runAgent} run). */
  rounds: number;
  /** The final round's grade. */
  grade: Grade;
  /** The final round's inner-run result (full + newly-added messages). */
  result: RunResult;
}
