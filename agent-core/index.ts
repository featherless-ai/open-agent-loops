/**
 * Public surface of the lightweight agent core. Import from here:
 *
 *   import { runAgent, InMemoryStore, FakeModelClient, defineTool } from "~/server/agent";
 *
 * Every exported piece sits behind an interface so it can be swapped:
 *   ModelClient  - the LLM boundary (FakeModelClient ships; add real ones)
 *   Memory       - conversation storage (InMemoryStore ships)
 *   Tool         - a callable capability
 *   StopCondition- when to end a run
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

export { any, maxSteps, whenToolCalled } from "./stop";
export type { StopCondition, StopContext } from "./stop";

export { runAgent } from "./loop";
export type { Hooks, RunAgentOptions, RunResult } from "./loop";
