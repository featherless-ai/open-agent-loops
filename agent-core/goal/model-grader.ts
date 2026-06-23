/**
 * `modelGrader` — the battery that turns a {@link ModelClient} (a fast grader
 * model) into a {@link Grader} for {@link runGoal}. This is the "separate model
 * grades the work each round" half of loop engineering.
 *
 * It is a *pure seam* battery (like `SessionMemoryStore` for `Memory`): it needs
 * only the `ModelClient` interface, so it ships as a default rather than a
 * must-implement. Each round it asks the model for a JSON verdict on whether the
 * goal is met, given the round's latest agent output.
 *
 * @module
 */

import type { ModelClient, ModelRequest } from "../model.types";
import { StreamEventType } from "../model.types";
import { contentToText, isAssistantMessage, userMessage } from "../types";
import type { Grade, GradeContext, Grader } from "./goal.types";

/**
 * Construction options for {@link modelGrader}.
 *
 * @group Goal Loop
 */
export interface ModelGraderOptions {
  /** The grader model — typically a small, fast one, separate from the agent. */
  model: ModelClient;
  /**
   * Override the grading system prompt. The default instructs the model to
   * return only a `{ done, score, feedback }` JSON verdict.
   */
  system?: string;
}

/**
 * The default grading system prompt: a strict verdict, JSON only.
 *
 * @internal
 */
const DEFAULT_GRADER_SYSTEM = `You are a strict evaluator inside an agent loop. Decide whether the agent has fully achieved the stated goal.

Respond with ONLY a JSON object, no surrounding prose, in exactly this shape:
{"done": true|false, "score": <number between 0 and 1>, "feedback": "<what to do next>"}

Set "done" to true only when the goal is completely satisfied. When "done" is false, "feedback" MUST state concretely what is still missing or wrong, so the agent can fix it on the next round.`;

/**
 * Build a {@link Grader} backed by a model.
 *
 * @remarks
 * The returned grader runs one model call per round: it feeds the goal and the
 * round's latest assistant output to the model and parses the JSON verdict it
 * returns (tolerating markdown fences or surrounding prose). It forwards
 * {@link GradeContext.signal | ctx.signal} so a cancelled goal loop also cancels
 * the in-flight grading call.
 *
 * @param options - The grader model and optional prompt override.
 * @returns A {@link Grader} suitable for {@link runGoal}.
 * @throws Error if the model returns no parseable JSON verdict.
 * @example
 * ```ts
 * const grader = modelGrader({ model: fastModel });
 * await runGoal({ goal, grader, base });
 * ```
 * @see {@link Grader}
 * @group Goal Loop
 */
export function modelGrader(options: ModelGraderOptions): Grader {
  const system = options.system ?? DEFAULT_GRADER_SYSTEM;

  return async (ctx: GradeContext): Promise<Grade> => {
    const request: ModelRequest = {
      system,
      messages: [userMessage({ content: buildPrompt(ctx) })],
      signal: ctx.signal,
    };
    const text = await collectText(options.model, request);
    return parseGrade(text);
  };
}

/**
 * Assemble the grading prompt from the goal and the round's latest output.
 * @internal
 */
function buildPrompt(ctx: GradeContext): string {
  const last = [...ctx.result.newMessages].reverse().find(isAssistantMessage);
  const output = last ? contentToText(last.content) : "(the agent produced no output)";
  return `GOAL:\n${ctx.goal}\n\nAGENT OUTPUT (round ${ctx.round}):\n${output}\n\nGrade whether the goal is satisfied.`;
}

/**
 * Drain a model stream to its final text, preferring the assembled `Done`
 * message and falling back to accumulated deltas.
 * @throws The stream's error if it ends in an `Error` event.
 * @internal
 */
async function collectText(model: ModelClient, request: ModelRequest): Promise<string> {
  let streamed = "";
  let final = "";
  for await (const event of model.stream(request)) {
    if (event.type === StreamEventType.TextDelta) {
      streamed += event.text;
    } else if (event.type === StreamEventType.Done) {
      final = event.message.content;
    } else if (event.type === StreamEventType.Error) {
      throw event.error;
    }
  }
  return (final || streamed).trim();
}

/**
 * Parse a {@link Grade} out of the model's text, tolerating markdown fences and
 * surrounding prose by extracting the first `{...}` span.
 * @throws Error when no JSON object is present or it does not parse.
 * @internal
 */
function parseGrade(text: string): Grade {
  const json = extractJsonObject(text);
  if (json === undefined) {
    throw new Error(`modelGrader: no JSON verdict found in grader output: ${truncate(text)}`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error(`modelGrader: grader verdict was not valid JSON: ${truncate(json)}`);
  }

  const grade: Grade = { done: parsed.done === true || parsed.done === "true" };
  if (typeof parsed.feedback === "string") grade.feedback = parsed.feedback;
  if (typeof parsed.score === "number") grade.score = parsed.score;
  return grade;
}

/**
 * Extract the outermost `{...}` span from a string, or `undefined` if none.
 * @internal
 */
function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  return text.slice(start, end + 1);
}

/**
 * Clip a string for inclusion in an error message.
 * @internal
 */
function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
