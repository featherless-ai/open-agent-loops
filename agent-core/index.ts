/**
 * Public surface of the lightweight agent core. Import from here:
 *
 *   import { runAgent, SessionMemoryStore, defineTool } from "~/agent-core";
 *
 * Composition over inheritance: every piece sits behind an interface that you
 * satisfy with a plain object/function, then optionally wrap with a decorator
 * (with*) — never subclassed.
 *   ModelClient  - the LLM boundary (implement `{ stream }`)
 *   Memory       - conversation storage (use SessionMemoryStore, or `{ load, ... }`)
 *   Tool         - a callable capability (defineTool: infers Zod arg types)
 *   StopCondition- when to end a run (compose with any / all / not)
 *
 * The streaming test double lives in `./mocks/mock-model` (MockModelClient);
 * it's a testing utility, imported directly by tests, not part of this surface.
 */

export type {
  AgentEvent,
  AgentEventBody,
  EventSink,
  Message,
  ToolCall,
} from "./types";

// Value exports: enums referenced at runtime by consumers comparing or
// constructing values (e.g. `event.type === AgentEventType.ToolStart`,
// `message.role === Role.User`).
export { AgentEventType, Role, ToolCallType } from "./types";

export type {
  ModelClient,
  ModelRequest,
  ModelStream,
  StreamEvent,
  ToolSpec,
} from "./model.types";

// Value export: the enum is referenced at runtime by consumers comparing or
// constructing stream-event types (e.g. `event.type === StreamEventType.Done`).
export { StreamEventType } from "./model.types";

export { SessionMemoryStore } from "./memory/session-memory";
export type { Memory, MemoryListener } from "./memory/memory.types";

export {
  defineTool,
  toToolSpec,
  validateToolArguments,
} from "./tools/tools";
export type { Tool, ToolContext, ToolResult } from "./tools/tools.types";
export { ExecutionMode } from "./tools/tools.types";

// Built-in tools: SDK-owned wiring over capability seams the consumer MUST
// implement (no host-binding backend is shipped — that is the consumer's, and
// the correct security boundary). Mocks live in `./mocks`, imported by tests.
export { formatShellResult, shellTool } from "./tools/builtin/shell";
export { formatSearchResults, searchTool } from "./tools/builtin/search";
export type {
  SearchBackend,
  SearchMatch,
  SearchQuery,
  ShellBackend,
  ShellResult,
} from "./tools/builtin/builtin.types";

export { all, any, maxSteps, not, whenToolCalled } from "./stop/conditions";
export type { StopCondition, StopContext } from "./stop/conditions.types";

export { withMemoryListeners, withMemoryNamespace, withModelObserver } from "./compose";

export { prepareRequestMessages, runAgent } from "./primitives/loop";
export type {
  GateDecision,
  Hooks,
  RunAgentOptions,
  RunResult,
  ToolGateRequest,
} from "./primitives/loop";

export { permissionGate } from "./permissions/permission-gate";
export { InMemoryPermissionStore } from "./permissions/in-memory-permission-store";
export type { InMemoryPermissionStoreOptions } from "./permissions/in-memory-permission-store";
export type {
  ApprovalPrompter,
  ApprovalRequest,
  PermissionStore,
} from "./permissions/permissions.types";
export { ApprovalChoice, PermissionPolicy } from "./permissions/permissions.types";
