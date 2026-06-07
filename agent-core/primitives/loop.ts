/**
 * The agentic loop — the fundamental thing. Everything it touches is an
 * interface ({@link ModelClient}, {@link Memory}, {@link Tool},
 * {@link StopCondition}), so the loop itself is provider-, storage-, and
 * tool-agnostic.
 *
 * One run:
 *   load history -> append prompt -> [ stream assistant -> run tools ]* -> done
 *
 * It stops when the model returns a turn with no tool calls (a final answer),
 * when a tool sets `terminate`, when a `stopWhen` condition fires, or when the
 * `maxSteps` safety cap is hit (prevents runaway loops).
 *
 * @see {@link runAgent}
 *
 * @module
 */

import type { AgentEventBody, EventSink, Message, ToolArguments, ToolCall } from "../types";
import { AgentEventType, Role } from "../types";
import type { ModelClient, ModelRequest } from "../model.types";
import { StreamEventType } from "../model.types";
import type { Memory } from "../memory/memory.types";
import type { Tool, ToolResult } from "../tools/tools.types";
import { ExecutionMode } from "../tools/tools.types";
import {
  parseToolArguments,
  toToolSpec,
  tryValidateToolArguments,
  validateToolArguments,
} from "../tools/tools";
import type { StopCondition } from "../stop/conditions.types";

/**
 * Internal emit function: call sites build an event body, and this stamps the
 * timestamp before handing the finished {@link AgentEvent} to the public sink.
 *
 * @internal
 */
type Emit = (event: AgentEventBody) => Promise<void>;

/**
 * One tool call presented to the gate, with its validated arguments.
 *
 * @group Hooks & Gating
 * @see {@link Hooks.gateToolCalls}
 */
export interface ToolGateRequest {
  /** The model's tool call, in its raw wire shape. */
  toolCall: ToolCall;
  /** The call's arguments, already JSON-parsed and schema-validated. */
  args: ToolArguments;
}

/**
 * The gate's verdict for one call: run it, or block it with a reason.
 *
 * @group Hooks & Gating
 * @see {@link Hooks.gateToolCalls}
 */
export interface GateDecision {
  /** Run the call when `true`; block it when `false`. */
  allow: boolean;
  /** Shown to the model as the error tool-result when `allow` is false. */
  reason?: string;
}

/**
 * What a {@link Hooks.beforeToolCall} hook returns to admit or block a call.
 *
 * @remarks
 * Returning nothing (or `block` falsy) lets the call proceed.
 *
 * @see {@link Hooks.beforeToolCall}
 * @group Hooks & Gating
 */
export interface ToolCallDecision {
  /** When true, block the call instead of executing it. */
  block?: boolean;
  /** Optional human-readable reason, surfaced as the blocked call's result. */
  reason?: string;
}

/**
 * What a {@link Hooks.afterToolCall} hook returns to override a result.
 *
 * @remarks
 * Returning nothing keeps the original result and error flag unchanged.
 *
 * @see {@link Hooks.afterToolCall}
 * @group Hooks & Gating
 */
export interface ToolResultOverride {
  /** Replacement tool result; omit to keep the original. */
  result?: ToolResult;
  /** Replacement error flag; omit to keep the original. */
  isError?: boolean;
}

/**
 * Lifecycle hooks for guardrails and context shaping.
 *
 * @remarks
 * Every hook is optional and may be sync or async. They run at fixed points in
 * a turn: {@link Hooks.transformContext | transformContext} just before the
 * model call, {@link Hooks.gateToolCalls | gateToolCalls} once per turn ahead of
 * execution, then {@link Hooks.beforeToolCall | beforeToolCall} /
 * {@link Hooks.afterToolCall | afterToolCall} around each individual call.
 *
 * @group Hooks & Gating
 */
export interface Hooks {
  /**
   * Reshape history right before it's sent to the model.
   *
   * @remarks
   * This is the seam for long-horizon context management — compaction
   * (summarize, then restart from the summary), structured note-taking, and
   * tool-result clearing — that keeps a long-running agent inside its context
   * window.
   *
   * Sources of truth:
   * - Anthropic, effective context engineering for AI agents:
   *   https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
   * - Anthropic, effective harnesses for long-running agents:
   *   https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
   *
   * @param messages - The current working history about to be sent.
   * @returns The (possibly reshaped) messages to send to the model.
   */
  transformContext?(messages: Message[]): Message[] | Promise<Message[]>;
  /**
   * Admit or block tool calls *as a batch*, before any of them execute.
   *
   * @remarks
   * The whole turn's calls arrive together, so this runs once per turn —
   * serially, ahead of the parallel execution phase — which makes it the right
   * place to prompt for permission without racing concurrent prompts. Only
   * well-formed calls (known tool + valid args) are presented; unknown/invalid
   * calls skip the gate and surface as the usual error results. See
   * `../permissions` for an allow/deny/ask implementation.
   *
   * @param batch - The turn's well-formed tool calls with parsed arguments.
   * @returns One {@link GateDecision} per request, index-aligned with `batch`.
   * @see {@link GateDecision}
   * @see {@link ToolGateRequest}
   */
  gateToolCalls?(batch: ToolGateRequest[]): GateDecision[] | Promise<GateDecision[]>;
  /**
   * Inspect/block a tool call before it executes.
   *
   * @param info - The call and its validated `args`.
   * @returns Nothing to proceed, or a {@link ToolCallDecision} to block it.
   */
  beforeToolCall?(info: {
    toolCall: ToolCall;
    args: ToolArguments;
  }): void | ToolCallDecision | Promise<void | ToolCallDecision>;
  /**
   * Inspect/override a tool result after it executes.
   *
   * @param info - The call, its `args`, the produced `result`, and `isError`.
   * @returns Nothing to keep the result, or a {@link ToolResultOverride}.
   */
  afterToolCall?(info: {
    toolCall: ToolCall;
    args: ToolArguments;
    result: ToolResult;
    isError: boolean;
  }): void | ToolResultOverride | Promise<void | ToolResultOverride>;
}

/**
 * Inputs for a single {@link runAgent} run.
 *
 * @group Core
 */
export interface RunAgentOptions {
  /** The LLM boundary the loop streams turns from. */
  model: ModelClient;
  /** The history store the run loads from and appends to. */
  memory: Memory;
  /** Session key used to load/append this conversation's history. */
  sessionId: string;
  /** New input for this run: a string, a single message, or several. */
  prompt: string | Message | Message[];
  /** Optional system prompt prepended to the request. */
  system?: string;
  /** Tools the model may call this run. */
  tools?: Tool[];
  /** Hard safety cap on model turns. Default 10. */
  maxSteps?: number;
  /** Optional early-stop predicate, evaluated after each turn's tools run. */
  stopWhen?: StopCondition;
  /** Lifecycle hooks for guardrails and context shaping. */
  hooks?: Hooks;
  /** Force sequential tool execution regardless of per-tool mode. */
  toolExecution?: ExecutionMode;
  /** Sink for observability/streaming events emitted during the run. */
  onEvent?: EventSink;
  /**
   * Cancel the run.
   *
   * @remarks
   * Aborting rejects {@link runAgent} with the signal's reason (an AbortError),
   * checked before each turn and right after each model stream. The signal is
   * also forwarded to the model request and every tool's `execute` context, so
   * a cooperating client/tool can abort in-flight work; the loop's own checks
   * guarantee it stops even if they don't.
   */
  signal?: AbortSignal;
}

/**
 * The outcome of a {@link runAgent} run.
 *
 * @group Core
 */
export interface RunResult {
  /** Full conversation after the run (loaded history + everything added). */
  messages: Message[];
  /** Only the messages added during this run (prompt, assistant, tool results). */
  newMessages: Message[];
  /** Number of model turns taken. */
  steps: number;
}

/**
 * Run the agentic loop for one session until it reaches a stopping point.
 *
 * @remarks
 * One run: load history, append the prompt, then repeat `[ stream assistant ->
 * run tools ]` until a stopping point. It stops when the model returns a turn
 * with no tool calls (a final answer), when a tool sets `terminate`, when a
 * {@link RunAgentOptions.stopWhen | stopWhen} condition fires, or when the
 * {@link RunAgentOptions.maxSteps | maxSteps} safety cap is hit (prevents
 * runaway loops).
 *
 * Everything it touches is an interface ({@link ModelClient}, {@link Memory},
 * {@link Tool}, {@link StopCondition}), so the loop itself is provider-,
 * storage-, and tool-agnostic.
 *
 * @param options - The model, memory, prompt, and run configuration.
 * @returns The full and newly-added messages plus the number of turns taken.
 * @throws The {@link RunAgentOptions.signal | signal}'s reason (an AbortError)
 *   if the run is cancelled.
 * @example
 * ```ts
 * const result = await runAgent({
 *   model: new OpenAICompatibleModel({ model: "deepseek-ai/DeepSeek-V3.1" }),
 *   memory: new SessionMemoryStore(),
 *   sessionId: "demo",
 *   prompt: "What is 2 + 2?",
 * });
 * console.log(result.messages.at(-1)?.content); // -> "4"
 * ```
 * @see {@link RunAgentOptions}
 * @see {@link RunResult}
 * @group Core
 */
export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const {
    model,
    memory,
    sessionId,
    system,
    tools = [],
    maxSteps = 10,
    stopWhen,
    hooks = {},
    toolExecution,
    onEvent,
    signal,
  } = options;

  const emit: Emit = async (event) => {
    await onEvent?.({ ...event, timestamp: Date.now() });
  };
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolSpecs = tools.length > 0 ? tools.map(toToolSpec) : undefined;

  // Seed the working history from memory, then add this run's prompt.
  const history = await memory.load(sessionId);
  const prompts = normalizePrompt(options.prompt);
  const newMessages: Message[] = [...prompts];
  const messages: Message[] = [...history, ...prompts];
  await memory.append(sessionId, prompts);

  await emit({ type: AgentEventType.AgentStart, sessionId });
  for (const prompt of prompts) {
    await emit({ type: AgentEventType.Message, message: prompt });
  }

  let steps = 0;
  while (true) {
    // Cancellation: stop promptly on abort — before any model call, and so a
    // post-tool abort ends here instead of spending one more turn. Throws the
    // signal's reason (an AbortError), rejecting runAgent.
    signal?.throwIfAborted();
    steps += 1;
    await emit({ type: AgentEventType.TurnStart, step: steps });

    // --- stream the assistant turn ---------------------------------------
    const contextMessages = hooks.transformContext
      ? await hooks.transformContext(messages)
      : messages;
    const request: ModelRequest = {
      system,
      // prepareRequestMessages returns a fresh array, so this doubles as the
      // snapshot the model sees — stable as the loop mutates `messages` later.
      messages: prepareRequestMessages(contextMessages),
      tools: toolSpecs,
      signal,
    };

    const assistant = await streamAssistant(model, request, emit);
    // If the stream was aborted, stop here rather than recording a partial,
    // interrupted assistant turn (a cooperating client turns abort into an
    // error event; this makes the run reject instead of returning it).
    signal?.throwIfAborted();
    messages.push(assistant);
    newMessages.push(assistant);
    await memory.append(sessionId, [assistant]);
    await emit({ type: AgentEventType.Message, message: assistant });

    const toolCalls = assistant.tool_calls ?? [];

    // Natural stop: a turn with no tool calls is the final answer.
    if (toolCalls.length === 0) {
      break;
    }

    // --- phase 1: gate the whole batch up front (serial) -----------------
    // Decide admission before anything runs, so a permission prompt happens
    // once, ahead of execution, and never races the parallel phase below.
    const gate = await gateToolBatch(toolCalls, toolsByName, hooks);

    const approved: ToolCall[] = [];
    const deniedResults: Message[] = [];
    for (let i = 0; i < toolCalls.length; i += 1) {
      if (gate[i]!.allow) approved.push(toolCalls[i]!);
      else deniedResults.push(await emitDenied(toolCalls[i]!, gate[i]!.reason, emit));
    }

    // --- phase 2: execute the approved calls (parallel by default) -------
    const { results: executed, terminate } = await executeToolCalls(
      approved,
      toolsByName,
      hooks,
      toolExecution,
      emit,
      signal,
    );

    // Reassemble results in the original call order (approved + denied), so the
    // model sees one tool-result per call in the order it requested them.
    let ai = 0;
    let di = 0;
    const results = toolCalls.map((_, i) =>
      gate[i]!.allow ? executed[ai++]! : deniedResults[di++]!,
    );

    for (const result of results) {
      messages.push(result);
      newMessages.push(result);
    }
    await memory.append(sessionId, results);

    if (terminate) break;

    if (
      stopWhen &&
      (await stopWhen({ step: steps, assistant, toolResults: results, messages }))
    ) {
      break;
    }

    // Safety cap last, so a legitimate final turn at the limit still counts.
    if (steps >= maxSteps) break;
  }

  await emit({ type: AgentEventType.AgentEnd, messages, steps });
  return { messages, newMessages, steps };
}

/**
 * Prepare working history for sending: drop `reasoning` from assistant turns
 * that did NOT call tools.
 *
 * @remarks
 * Reasoning is resent only on tool-call turns — thinking-mode models (e.g.
 * DeepSeek V4) require it there for tool-call continuity and reject the request
 * otherwise, while on plain turns the model ignores it.
 *
 * @param messages - The working history to prepare. Never mutated.
 * @returns A fresh array with reasoning stripped from non-tool-call turns.
 * @see {@link Message.reasoning}
 * @group Core
 */
export function prepareRequestMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    const isToolCallTurn = (message.tool_calls?.length ?? 0) > 0;
    if (message.role === Role.Assistant && message.reasoning !== undefined && !isToolCallTurn) {
      const { reasoning: _dropped, ...rest } = message;
      return rest;
    }
    return message;
  });
}

/**
 * Consume a model stream into one assistant message, emitting deltas.
 *
 * @internal
 */
async function streamAssistant(
  model: ModelClient,
  request: ModelRequest,
  emit: Emit,
): Promise<Message> {
  let text = "";
  let reasoning = "";
  const toolCalls: ToolCall[] = [];
  let finalMessage: Message | undefined;

  for await (const event of model.stream(request)) {
    switch (event.type) {
      case StreamEventType.ReasoningDelta:
        reasoning += event.text;
        await emit({ type: AgentEventType.ReasoningDelta, text: event.text });
        break;
      case StreamEventType.TextDelta:
        text += event.text;
        await emit({ type: AgentEventType.TextDelta, text: event.text });
        break;
      case StreamEventType.ToolCall:
        toolCalls.push(event.toolCall);
        break;
      case StreamEventType.Done:
        finalMessage = event.message;
        break;
      case StreamEventType.Error:
        // Surface the partial message but mark it so the loop can stop.
        finalMessage = { ...event.message, isError: true };
        break;
    }
  }

  // Prefer the model's assembled message; otherwise rebuild from deltas.
  return (
    finalMessage ?? {
      role: Role.Assistant,
      content: text,
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      timestamp: Date.now(),
    }
  );
}

/**
 * Phase 1 of tool handling: ask the gate hook to admit/block the batch before
 * anything runs. Only well-formed calls (known tool + valid args) are presented
 * — unknown or malformed calls are auto-allowed here so they flow on to produce
 * their normal error results in execution, rather than prompting about a call
 * that can't run. With no gate hook, everything is allowed.
 *
 * @internal
 */
async function gateToolBatch(
  toolCalls: ToolCall[],
  toolsByName: Map<string, Tool>,
  hooks: Hooks,
): Promise<GateDecision[]> {
  const decisions: GateDecision[] = toolCalls.map(() => ({ allow: true }));
  if (!hooks.gateToolCalls) return decisions;

  // Present only well-formed calls; remember each one's original position.
  const gateable: Array<{ index: number; request: ToolGateRequest }> = [];
  toolCalls.forEach((toolCall, index) => {
    const tool = toolsByName.get(toolCall.function.name);
    if (!tool) return;
    const parsed = tryValidateToolArguments(tool, toolCall);
    if (!parsed.ok) return;
    gateable.push({ index, request: { toolCall, args: parsed.value } });
  });
  if (gateable.length === 0) return decisions;

  const verdicts = await hooks.gateToolCalls(gateable.map((g) => g.request));
  gateable.forEach((g, k) => {
    decisions[g.index] = verdicts[k] ?? { allow: true };
  });
  return decisions;
}

/**
 * Emit start/end events and build the error tool-result for a blocked call.
 *
 * @internal
 */
async function emitDenied(
  call: ToolCall,
  reason: string | undefined,
  emit: Emit,
): Promise<Message> {
  const content = reason ?? "Tool execution denied";
  const name = call.function.name;
  await emit({ type: AgentEventType.ToolStart, toolCallId: call.id, toolName: name, args: parseToolArguments(call) });
  await emit({ type: AgentEventType.ToolEnd, toolCallId: call.id, toolName: name, result: content, isError: true });
  return {
    role: Role.Tool,
    content,
    tool_call_id: call.id,
    toolName: name,
    isError: true,
    timestamp: Date.now(),
  };
}

/** @internal */
interface ToolBatchOutcome {
  results: Message[];
  /** True when every tool in the batch asked to terminate the run. */
  terminate: boolean;
}

/**
 * Run a batch of tool calls, parallel by default, sequential when required.
 *
 * @internal
 */
async function executeToolCalls(
  toolCalls: ToolCall[],
  toolsByName: Map<string, Tool>,
  hooks: Hooks,
  mode: ExecutionMode | undefined,
  emit: Emit,
  signal: AbortSignal | undefined,
): Promise<ToolBatchOutcome> {
  const hasSequentialTool = toolCalls.some(
    (call) => toolsByName.get(call.function.name)?.executionMode === ExecutionMode.Sequential,
  );
  const sequential = mode === ExecutionMode.Sequential || hasSequentialTool;

  let outcomes: FinalizedCall[];
  if (sequential) {
    outcomes = [];
    for (const call of toolCalls) {
      outcomes.push(await executeOne(call, toolsByName, hooks, emit, signal));
    }
  } else {
    outcomes = await Promise.all(
      toolCalls.map((call) => executeOne(call, toolsByName, hooks, emit, signal)),
    );
  }

  return {
    results: outcomes.map((outcome) => outcome.message),
    terminate:
      outcomes.length > 0 && outcomes.every((outcome) => outcome.terminate),
  };
}

/** @internal */
interface FinalizedCall {
  message: Message;
  terminate: boolean;
}

/**
 * Validate -> beforeToolCall -> execute -> afterToolCall, never throwing.
 *
 * @internal
 */
async function executeOne(
  call: ToolCall,
  toolsByName: Map<string, Tool>,
  hooks: Hooks,
  emit: Emit,
  signal: AbortSignal | undefined,
): Promise<FinalizedCall> {
  const name = call.function.name;
  await emit({
    type: AgentEventType.ToolStart,
    toolCallId: call.id,
    toolName: name,
    args: parseToolArguments(call),
  });

  let result: ToolResult;
  let isError = false;

  const tool = toolsByName.get(name);
  if (!tool) {
    result = { content: `Tool "${name}" not found` };
    isError = true;
  } else {
    try {
      const args = validateToolArguments(tool, call);

      const before = await hooks.beforeToolCall?.({ toolCall: call, args });
      if (before?.block) {
        result = { content: before.reason ?? "Tool execution blocked" };
        isError = true;
      } else {
        result = await tool.execute(args as never, { toolCallId: call.id, signal });
      }

      const after = await hooks.afterToolCall?.({
        toolCall: call,
        args,
        result,
        isError,
      });
      if (after) {
        result = after.result ?? result;
        isError = after.isError ?? isError;
      }
    } catch (error) {
      result = { content: error instanceof Error ? error.message : String(error) };
      isError = true;
    }
  }

  await emit({
    type: AgentEventType.ToolEnd,
    toolCallId: call.id,
    toolName: name,
    result: result.content,
    isError,
  });

  const message: Message = {
    role: Role.Tool,
    content: result.content,
    tool_call_id: call.id,
    toolName: name,
    isError,
    timestamp: Date.now(),
  };
  return { message, terminate: result.terminate === true && !isError };
}

/**
 * Accept a string / single message / array and normalize to Message[].
 *
 * @internal
 */
function normalizePrompt(prompt: string | Message | Message[]): Message[] {
  if (typeof prompt === "string") {
    return [{ role: Role.User, content: prompt, timestamp: Date.now() }];
  }
  return Array.isArray(prompt) ? prompt : [prompt];
}
