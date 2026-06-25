/**
 * {@link agentAsTool} — wrap an agent as a {@link Tool} another agent can call.
 *
 * @remarks
 * The foundation for a single-chat multi-agent orchestrator: a parent
 * {@link runAgent} loop holds one or more specialist sub-agents as tools and
 * routes to them, all over one conversation. When the parent model calls the
 * tool with a `task`, the tool runs a *child* `runAgent` with that task as the
 * prompt and hands the child's final answer back as the tool result.
 *
 * Same posture as {@link ToolRegistry | ./registry}, `SkillRegistry`, and
 * `runGoal`: composition *over* `runAgent`, never a loop dependency. The loop
 * still takes a plain `Tool[]` and never learns about sub-agents — this factory
 * wraps `runAgent` exactly as `runGoal` does, with the run function injectable
 * ({@link RunFn}, default `runAgent`) so tests drive it with a fake.
 *
 * **Context isolation by default.** The whole value of agent-as-tool is that the
 * sub-agent burns *its own* context window and returns only a distilled result,
 * keeping the parent's thread clean. So each call runs in a fresh, empty session
 * by default (a new {@link SessionMemoryStore}; `sessionId = name:toolCallId`,
 * keyed by the call so every invocation is isolated and traceable). Pass
 * {@link AgentAsToolOptions.memory | memory} + {@link AgentAsToolOptions.sessionId | sessionId}
 * to opt into continuity across calls. `ctx.signal` is forwarded to the child so
 * a parent abort cancels it.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "./tools";
import type { Tool, ToolResult } from "./tools.types";
import { runAgent } from "../primitives/loop";
import type { RunAgentOptions, RunResult } from "../primitives/loop";
import { SessionMemoryStore } from "../memory/session-memory";
import type { Memory } from "../memory/memory.types";
import { contentToText, isAssistantMessage } from "../types";

/**
 * How a sub-agent run executes. Defaults to {@link runAgent}; injectable so tests
 * drive it with a controllable fake instead of a real model.
 *
 * @internal
 */
type RunFn = (options: RunAgentOptions) => Promise<RunResult>;

/**
 * Options for {@link agentAsTool}.
 *
 * @remarks
 * Reuses the run contract: everything {@link runAgent} needs *except* the fields
 * the tool controls — `prompt` (the model's `task`), `sessionId` and `memory` (the
 * isolation defaults), and `signal` (forwarded from the tool-call context). So
 * `model` is required, and `system` / `tools` / `maxSteps` / `stopWhen` / `hooks`
 * / `toolExecution` / `onEvent` configure the child run. Mirrors the
 * `Omit<RunAgentOptions, …>` "RunBase" shape used by `runGoal` and the dispatcher.
 *
 * @group Multi-Agent
 */
export type AgentAsToolOptions = Omit<
  RunAgentOptions,
  "prompt" | "sessionId" | "memory" | "signal"
> & {
  /** Model-facing tool name (keep it snake_case), e.g. `"researcher"`. */
  name: string;
  /** What this sub-agent is for — tells the parent model *when* to call it. */
  description: string;
  /**
   * Backing store for the child run. Default: a fresh {@link SessionMemoryStore}
   * created *per call*, which is what makes each call context-isolated. Supply
   * one (with a stable {@link AgentAsToolOptions.sessionId | sessionId}) to give
   * the sub-agent memory that persists across calls.
   */
  memory?: Memory;
  /**
   * Session key for the child run. Default: `` `${name}:${toolCallId}` `` — unique
   * per call, so invocations stay isolated and each is traceable to its call.
   */
  sessionId?: string;
  /** Describes the `task` argument to the parent model. Has a sensible default. */
  inputDescription?: string;
  /**
   * How to turn the child {@link RunResult} into the tool-result text. Default:
   * the last assistant message's text (falling back to a clear placeholder when
   * the run produced none).
   */
  resultFrom?: (result: RunResult) => string;
  /** Override how the child run executes (for tests). Default {@link runAgent}. */
  run?: RunFn;
};

/**
 * The last assistant message's text in a run, scanning from the end; `""` when
 * the run produced no assistant text.
 *
 * @internal
 */
function lastAssistantText(result: RunResult): string {
  for (let i = result.newMessages.length - 1; i >= 0; i--) {
    const message = result.newMessages[i]!;
    if (isAssistantMessage(message)) {
      const text = contentToText(message.content).trim();
      if (text) return text;
    }
  }
  return "";
}

/**
 * Wrap an agent as a {@link Tool} another agent can call.
 *
 * @remarks
 * The returned tool's `execute` runs a child {@link runAgent} with the model's
 * `task` as the prompt and returns its final answer as the tool result
 * `content`. The full child {@link RunResult} rides {@link ToolResult.details}
 * (never sent to the model) for hooks and the tracer. By default each call is
 * context-isolated (fresh session per call); see {@link AgentAsToolOptions} for
 * continuity, result shaping, and the injectable run.
 *
 * @param options - The sub-agent's identity (`name`/`description`) and run config.
 * @returns A {@link Tool} ready for `runAgent` or a {@link ToolRegistry}.
 * @see {@link AgentAsToolOptions}
 * @example
 * ```ts
 * const researcher = agentAsTool({
 *   name: "researcher",
 *   description: "Researches a question and reports findings.",
 *   model,
 *   system: "You are a meticulous researcher. Answer concisely.",
 *   tools: [webSearchTool(backend)],
 * });
 *
 * // The orchestrator calls it like any tool:
 * await runAgent({ ...opts, tools: [researcher], prompt: "Compare X and Y." });
 * ```
 * @group Multi-Agent
 */
export function agentAsTool(options: AgentAsToolOptions): Tool {
  const {
    name,
    description,
    inputDescription,
    resultFrom,
    run = runAgent,
    memory: memoryOption,
    sessionId: sessionIdOption,
    ...runConfig
  } = options;

  const extractResult =
    resultFrom ??
    ((result: RunResult): string =>
      lastAssistantText(result) || `(the ${name} sub-agent produced no output)`);

  return defineTool({
    name,
    description,
    parameters: z.object({
      task: z
        .string()
        .describe(
          inputDescription ??
            "A self-contained instruction describing what you want this sub-agent to do.",
        ),
    }),
    execute: async ({ task }, ctx): Promise<ToolResult> => {
      const memory = memoryOption ?? new SessionMemoryStore();
      const sessionId = sessionIdOption ?? `${name}:${ctx.toolCallId}`;

      const result = await run({
        ...runConfig,
        memory,
        sessionId,
        prompt: task,
        signal: ctx.signal,
      });

      return {
        content: extractResult(result),
        details: { sessionId, steps: result.steps, result },
      };
    },
  });
}
