import { describe, expect, test } from "bun:test";
import { runGoal } from "../goal/goal";
import { modelGrader } from "../goal/model-grader";
import type { Grade, GradeContext, RunFn, RunGoalRunBase } from "../goal/goal.types";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { RunResult } from "../primitives/loop";
import { assistantMessage, contentToText } from "../types";

// `base` only needs to typecheck — the injected `run` ignores model/memory.
const base = (): RunGoalRunBase => ({
  model: new MockModelClient([]),
  memory: new SessionMemoryStore(),
  sessionId: "s",
});

const RESULT: RunResult = { messages: [], newMessages: [], steps: 1 };

/** A controllable {@link RunFn} that records each round's prompt + signal and
 * returns a canned result so the outer loop advances synchronously. */
function recordingRun() {
  const calls: { prompt: unknown; signal?: AbortSignal }[] = [];
  const run: RunFn = async (opts) => {
    calls.push({ prompt: opts.prompt, signal: opts.signal });
    return RESULT;
  };
  return { run, calls };
}

/** A grader that replays a fixed list of verdicts, one per round. */
const scriptedGrader = (grades: Grade[]) => (ctx: { round: number }) => grades[ctx.round - 1]!;

describe("runGoal", () => {
  // A `done` verdict on the first round stops immediately.
  test("stops on the first round when the grader says done", async () => {
    const h = recordingRun();
    const outcome = await runGoal({
      goal: "G",
      grader: () => ({ done: true }),
      base: base(),
      run: h.run,
    });

    expect(outcome.done).toBe(true);
    expect(outcome.rounds).toBe(1);
    expect(h.calls.length).toBe(1);
  });

  // A not-done verdict re-prompts the NEXT round with the grader's feedback.
  test("re-prompts the next round with the grader's feedback until done", async () => {
    const h = recordingRun();
    const outcome = await runGoal({
      goal: "G",
      grader: scriptedGrader([{ done: false, feedback: "fix it" }, { done: true }]),
      base: base(),
      run: h.run,
    });

    expect(outcome.rounds).toBe(2);
    expect(outcome.done).toBe(true);
    expect(h.calls[0]!.prompt).toBe("G"); // round 1 = goal (no prompt given)
    expect(h.calls[1]!.prompt).toBe("fix it"); // round 2 = feedback
  });

  // The maxRounds cap stops the loop with done:false (goal never satisfied).
  test("stops at maxRounds without satisfying the goal", async () => {
    const h = recordingRun();
    const outcome = await runGoal({
      goal: "G",
      grader: () => ({ done: false, feedback: "again" }),
      base: base(),
      run: h.run,
      maxRounds: 3,
    });

    expect(outcome.rounds).toBe(3);
    expect(outcome.done).toBe(false);
    expect(h.calls.length).toBe(3);
  });

  // An explicit first prompt overrides the goal-as-prompt default.
  test("uses an explicit first prompt over the goal default", async () => {
    const h = recordingRun();
    await runGoal({
      goal: "G",
      prompt: "start here",
      grader: () => ({ done: true }),
      base: base(),
      run: h.run,
    });

    expect(h.calls[0]!.prompt).toBe("start here");
  });

  // The signal is forwarded to each round and re-checked at the top of the next
  // round, so an abort between rounds rejects before another round starts.
  test("forwards the signal and aborts between rounds", async () => {
    const h = recordingRun();
    const controller = new AbortController();

    const promise = runGoal({
      goal: "G",
      grader: () => ({ done: false, feedback: "again" }),
      base: base(),
      run: h.run,
      signal: controller.signal,
      onRound: ({ round }) => {
        if (round === 1) controller.abort();
      },
    });

    await expect(promise).rejects.toThrow();
    expect(h.calls.length).toBe(1); // round 2 never started
    expect(h.calls[0]!.signal).toBe(controller.signal); // signal forwarded inward
  });

  // onRound observes every round's verdict, in order.
  test("reports each round's grade via onRound", async () => {
    const h = recordingRun();
    const seen: { round: number; done: boolean }[] = [];

    await runGoal({
      goal: "G",
      grader: scriptedGrader([
        { done: false, feedback: "a" },
        { done: false, feedback: "b" },
        { done: true },
      ]),
      base: base(),
      run: h.run,
      onRound: ({ round, grade }) => {
        seen.push({ round, done: grade.done });
      },
    });

    expect(seen).toEqual([
      { round: 1, done: false },
      { round: 2, done: false },
      { round: 3, done: true },
    ]);
  });
});

/** A round result whose latest assistant output is `output`. */
const resultWith = (output: string): RunResult => {
  const am = assistantMessage({ content: output });
  return { messages: [am], newMessages: [am], steps: 1 };
};

const ctxWith = (output: string, round = 1): GradeContext => ({
  goal: "G",
  round,
  result: resultWith(output),
});

describe("modelGrader", () => {
  // A `done` verdict round-trips through the model into a Grade.
  test("parses a done verdict with score", async () => {
    const model = new MockModelClient([{ text: '{"done": true, "score": 1}' }]);
    const grade = await modelGrader({ model })(ctxWith("answer"));

    expect(grade.done).toBe(true);
    expect(grade.score).toBe(1);
  });

  // A not-done verdict carries the feedback that becomes the next prompt.
  test("parses a not-done verdict with feedback", async () => {
    const model = new MockModelClient([{ text: '{"done": false, "feedback": "fix X"}' }]);
    const grade = await modelGrader({ model })(ctxWith("answer"));

    expect(grade.done).toBe(false);
    expect(grade.feedback).toBe("fix X");
  });

  // Markdown-fenced JSON (a common model habit) is tolerated.
  test("tolerates markdown-fenced JSON", async () => {
    const model = new MockModelClient([{ text: '```json\n{"done": true}\n```' }]);
    const grade = await modelGrader({ model })(ctxWith("answer"));

    expect(grade.done).toBe(true);
  });

  // The grading request carries the goal, the round, and the agent's latest output.
  test("feeds the goal and the agent's output into the grading prompt", async () => {
    const model = new MockModelClient([{ text: '{"done": true}' }]);
    await modelGrader({ model })({
      goal: "summarize the doc",
      round: 2,
      result: resultWith("THE-AGENT-ANSWER"),
    });

    const prompt = contentToText(model.requests[0]!.messages[0]!.content);
    expect(prompt).toContain("summarize the doc");
    expect(prompt).toContain("THE-AGENT-ANSWER");
    expect(prompt).toContain("round 2");
  });

  // No JSON verdict is a misconfiguration worth surfacing, not swallowing.
  test("throws when the grader returns no JSON verdict", async () => {
    const model = new MockModelClient([{ text: "looks good to me honestly" }]);
    await expect(modelGrader({ model })(ctxWith("answer"))).rejects.toThrow(/no JSON verdict/);
  });

  // End-to-end: runGoal drives a real runAgent, modelGrader re-prompts once, then
  // passes — and round 2's agent prompt carries the grader's feedback.
  test("drives runAgent across rounds via modelGrader feedback", async () => {
    const agentModel = new MockModelClient(() => ({ text: "answer" }));
    const graderModel = new MockModelClient([
      { text: '{"done": false, "feedback": "add more detail"}' },
      { text: '{"done": true, "score": 1}' },
    ]);

    const outcome = await runGoal({
      goal: "Write a detailed answer.",
      grader: modelGrader({ model: graderModel }),
      base: { model: agentModel, memory: new SessionMemoryStore(), sessionId: "e2e" },
    });

    expect(outcome.done).toBe(true);
    expect(outcome.rounds).toBe(2);
    expect(agentModel.requests.length).toBe(2);

    // Round 2's inner run saw the grader's feedback as its new prompt.
    const round2 = agentModel.requests[1]!.messages.map((m) => contentToText(m.content)).join("\n");
    expect(round2).toContain("add more detail");
  });
});
