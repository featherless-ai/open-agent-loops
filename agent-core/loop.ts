/**
 * The agentic loop — the fundamental thing. Everything it touches is an
 * interface (ModelClient, Memory, Tool, StopCondition), so the loop itself is
 * provider-, storage-, and tool-agnostic.
 *
 * One run:
 *   load history -> append prompt -> [ stream assistant -> run tools ]* -> done
 *
 * It stops when the model returns a turn with no tool calls (a final answer),
 * when a tool sets `terminate`, when a `stopWhen` condition fires, or when the
 * `maxSteps` safety cap is hit (prevents runaway loops).
 */

import type { AgentEvent, EventSink, Message, ToolCall } from "./types";
import type { ModelClient, ModelRequest } from "./model";
import type { Memory } from "./memory";
import { type Tool, type ToolResult, toToolSpec, validateToolArguments } from "./tools";
import type { StopCondition } from "./stop";

/** Lifecycle hooks for guardrails and context shaping. */
export interface Hooks {
  /** Reshape history right before it's sent to the model. */
  transformContext?(messages: Message[]): Message[] | Promise<Message[]>;
  /** Inspect/block a tool call before it executes. */
  beforeToolCall?(info: {
    toolCall: ToolCall;
    args: unknown;
  }): void | { block?: boolean; reason?: string } | Promise<void | { block?: boolean; reason?: string }>;
  /** Inspect/override a tool result after it executes. */
  afterToolCall?(info: {
    toolCall: ToolCall;
    args: unknown;
    result: ToolResult;
    isError: boolean;
  }):
    | void
    | { result?: ToolResult; isError?: boolean }
    | Promise<void | { result?: ToolResult; isError?: boolean }>;
}

export interface RunAgentOptions {
  model: ModelClient;
  memory: Memory;
  sessionId: string;
  /** New input for this run: a string, a single message, or several. */
  prompt: string | Message | Message[];
  system?: string;
  tools?: Tool[];
  /** Hard safety cap on model turns. Default 10. */
  maxSteps?: number;
  /** Optional early-stop predicate, evaluated after each turn's tools run. */
  stopWhen?: StopCondition;
  hooks?: Hooks;
  /** Force sequential tool execution regardless of per-tool mode. */
  toolExecution?: "parallel" | "sequential";
  onEvent?: EventSink;
  signal?: AbortSignal;
}

export interface RunResult {
  /** Full conversation after the run (loaded history + everything added). */
  messages: Message[];
  /** Only the messages added during this run (prompt, assistant, tool results). */
  newMessages: Message[];
  /** Number of model turns taken. */
  steps: number;
}

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

  const emit = async (event: AgentEvent) => {
    await onEvent?.(event);
  };
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolSpecs = tools.length > 0 ? tools.map(toToolSpec) : undefined;

  // Seed the working history from memory, then add this run's prompt.
  const history = await memory.load(sessionId);
  const prompts = normalizePrompt(options.prompt);
  const newMessages: Message[] = [...prompts];
  const messages: Message[] = [...history, ...prompts];
  await memory.append(sessionId, prompts);

  await emit({ type: "agent_start", sessionId });
  for (const prompt of prompts) {
    await emit({ type: "message", message: prompt });
  }

  let steps = 0;
  while (true) {
    steps += 1;
    await emit({ type: "turn_start", step: steps });

    // --- stream the assistant turn ---------------------------------------
    const contextMessages = hooks.transformContext
      ? await hooks.transformContext(messages)
      : messages;
    const request: ModelRequest = {
      system,
      // Snapshot: the model gets a stable view that won't change as the loop
      // keeps mutating its working `messages` array on later turns.
      messages: [...contextMessages],
      tools: toolSpecs,
      signal,
    };

    const assistant = await streamAssistant(model, request, emit);
    messages.push(assistant);
    newMessages.push(assistant);
    await memory.append(sessionId, [assistant]);
    await emit({ type: "message", message: assistant });

    const toolCalls = assistant.toolCalls ?? [];

    // Natural stop: a turn with no tool calls is the final answer.
    if (toolCalls.length === 0) {
      break;
    }

    // --- run the requested tools -----------------------------------------
    const { results, terminate } = await executeToolCalls(
      toolCalls,
      toolsByName,
      hooks,
      toolExecution,
      emit,
      signal,
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

  await emit({ type: "agent_end", messages, steps });
  return { messages, newMessages, steps };
}

/** Consume a model stream into one assistant message, emitting deltas. */
async function streamAssistant(
  model: ModelClient,
  request: ModelRequest,
  emit: EventSink,
): Promise<Message> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let finalMessage: Message | undefined;

  for await (const event of model.stream(request)) {
    switch (event.type) {
      case "text_delta":
        text += event.text;
        await emit({ type: "text_delta", text: event.text });
        break;
      case "tool_call":
        toolCalls.push(event.toolCall);
        break;
      case "done":
        finalMessage = event.message;
        break;
      case "error":
        // Surface the partial message but mark it so the loop can stop.
        finalMessage = { ...event.message, isError: true };
        break;
    }
  }

  // Prefer the model's assembled message; otherwise rebuild from deltas.
  return (
    finalMessage ?? {
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      timestamp: Date.now(),
    }
  );
}

interface ToolBatchOutcome {
  results: Message[];
  /** True when every tool in the batch asked to terminate the run. */
  terminate: boolean;
}

/** Run a batch of tool calls, parallel by default, sequential when required. */
async function executeToolCalls(
  toolCalls: ToolCall[],
  toolsByName: Map<string, Tool>,
  hooks: Hooks,
  mode: "parallel" | "sequential" | undefined,
  emit: EventSink,
  signal: AbortSignal | undefined,
): Promise<ToolBatchOutcome> {
  const hasSequentialTool = toolCalls.some(
    (call) => toolsByName.get(call.name)?.executionMode === "sequential",
  );
  const sequential = mode === "sequential" || hasSequentialTool;

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

interface FinalizedCall {
  message: Message;
  terminate: boolean;
}

/** Validate -> beforeToolCall -> execute -> afterToolCall, never throwing. */
async function executeOne(
  call: ToolCall,
  toolsByName: Map<string, Tool>,
  hooks: Hooks,
  emit: EventSink,
  signal: AbortSignal | undefined,
): Promise<FinalizedCall> {
  await emit({
    type: "tool_start",
    toolCallId: call.id,
    toolName: call.name,
    args: call.arguments,
  });

  let result: ToolResult;
  let isError = false;

  const tool = toolsByName.get(call.name);
  if (!tool) {
    result = { content: `Tool "${call.name}" not found` };
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
    type: "tool_end",
    toolCallId: call.id,
    toolName: call.name,
    result: result.content,
    isError,
  });

  const message: Message = {
    role: "tool",
    content: result.content,
    toolCallId: call.id,
    toolName: call.name,
    isError,
    timestamp: Date.now(),
  };
  return { message, terminate: result.terminate === true && !isError };
}

/** Accept a string / single message / array and normalize to Message[]. */
function normalizePrompt(prompt: string | Message | Message[]): Message[] {
  if (typeof prompt === "string") {
    return [{ role: "user", content: prompt, timestamp: Date.now() }];
  }
  return Array.isArray(prompt) ? prompt : [prompt];
}
