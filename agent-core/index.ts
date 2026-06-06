/**
 * Public surface of the lightweight agent core. Import from here:
 *
 *   import { runAgent, InMemoryStore, FakeModelClient, defineTool } from "~/agent-core";
 *
 * Composition over inheritance: every piece sits behind an interface that you
 * satisfy with a plain object/function, then optionally wrap with a decorator
 * (with*) — never subclassed.
 *   ModelClient  - the LLM boundary (use FakeModelClient, or `{ stream }`)
 *   Memory       - conversation storage (use InMemoryStore, or `{ load, ... }`)
 *   Tool         - a callable capability (defineTool: infers Zod arg types)
 *   StopCondition- when to end a run (compose with any / all / not)
 */

export type {
  AgentEvent,
  EventSink,
  Message,
  Role,
  ToolCall,
} from "./types";

export type {
  ModelClient,
  ModelRequest,
  ModelStream,
  StreamEvent,
  ToolSpec,
} from "./model";

export { FakeModelClient } from "./fake-model";
export type { Script, ScriptedTurn, FakeModelOptions } from "./fake-model";

export { InMemoryStore } from "./memory";
export type { Memory } from "./memory";

export {
  defineTool,
  toToolSpec,
  validateToolArguments,
} from "./tools";
export type { Tool, ToolContext, ToolResult } from "./tools";

export { all, any, maxSteps, not, whenToolCalled } from "./stop";
export type { StopCondition, StopContext } from "./stop";

export { withMemoryNamespace, withModelObserver } from "./compose";

export { runAgent } from "./loop";
export type { Hooks, RunAgentOptions, RunResult } from "./loop";
