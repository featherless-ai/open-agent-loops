/**
 * Public surface of the lightweight agent core. Import from here:
 *
 *   import { runAgent, InMemoryStore, defineTool } from "~/agent-core";
 *
 * Composition over inheritance: every piece sits behind an interface that you
 * satisfy with a plain object/function, then optionally wrap with a decorator
 * (with*) — never subclassed.
 *   ModelClient  - the LLM boundary (implement `{ stream }`)
 *   Memory       - conversation storage (use InMemoryStore, or `{ load, ... }`)
 *   Tool         - a callable capability (defineTool: infers Zod arg types)
 *   StopCondition- when to end a run (compose with any / all / not)
 *
 * The streaming test double lives in `./mocks/fake-model` (FakeModelClient);
 * it's a testing utility, imported directly by tests, not part of this surface.
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
} from "./model.types";

export { InMemoryStore } from "./memory/memory";
export type { Memory, MemoryListener } from "./memory/memory.types";

export {
  defineTool,
  toToolSpec,
  validateToolArguments,
} from "./tools/tools";
export type { Tool, ToolContext, ToolResult } from "./tools/tools.types";

export { all, any, maxSteps, not, whenToolCalled } from "./stop/conditions";
export type { StopCondition, StopContext } from "./stop/conditions.types";

export { withMemoryListeners, withMemoryNamespace, withModelObserver } from "./compose";

export { prepareRequestMessages, runAgent } from "./primitives/loop";
export type { Hooks, RunAgentOptions, RunResult } from "./primitives/loop";
