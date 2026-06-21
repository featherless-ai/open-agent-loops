/**
 * Public surface of the lightweight agent core — the single entry point you
 * import from.
 *
 * @remarks
 * Composition over inheritance: every piece sits behind an interface that you
 * satisfy with a plain object/function, then optionally wrap with a decorator
 * (the `with*` helpers) — never subclassed. The four interfaces you implement or
 * supply:
 *
 * - {@link ModelClient} — the LLM boundary (implement `{ stream }`).
 * - {@link Memory} — conversation storage (use {@link SessionMemoryStore}, or
 *   your own `{ load, ... }`).
 * - {@link Tool} — a callable capability (author with {@link defineTool}, which
 *   infers argument types from the Zod schema).
 * - {@link StopCondition} — when to end a run (compose with {@link any} /
 *   {@link all} / {@link not}).
 *
 * The streaming test double (`MockModelClient`) lives in `./mocks/mock-model`;
 * it is a testing utility imported directly by tests, not part of this published
 * surface.
 *
 * @example Minimal run
 * ```ts
 * import { runAgent, SessionMemoryStore, defineTool } from "@open-agent-os/core";
 *
 * const result = await runAgent({
 *   model,                       // your ModelClient
 *   memory: new SessionMemoryStore(),
 *   sessionId: "demo",
 *   tools: [searchTool(backend)],
 *   prompt: "Find the TODOs in this repo.",
 * });
 * console.log(result.newMessages); // messages produced by this run
 * ```
 *
 * @see {@link runAgent} — the loop entry point.
 * @see {@link ToolRegistry} — build a tool catalog and resolve subsets by name.
 * @packageDocumentation
 */

export type {
  AgentEvent,
  AgentEventBody,
  AssistantMessage,
  AudioPart,
  ContentPart,
  EventSink,
  FilePart,
  ImagePart,
  Message,
  ReasoningDetail,
  ReasoningDetailBase,
  ReasoningEncryptedDetail,
  ReasoningSummaryDetail,
  ReasoningTextDetail,
  SystemMessage,
  TextPart,
  ToolArguments,
  ToolCall,
  ToolMessage,
  UserMessage,
} from "./types";

// Value exports: enums referenced at runtime by consumers comparing or
// constructing values (e.g. `event.type === AgentEventType.ToolStart`,
// `message.role === Role.User`, `message.finishReason === FinishReason.Length`).
export { AgentEventType, FinishReason, ReasoningFormat, Role, ToolCallType } from "./types";

// Type guards that narrow a `Message` union to a specific role variant — handy
// for `messages.filter(isToolMessage)` before reading role-specific fields.
export { isAssistantMessage, isToolMessage } from "./types";

// Factories that construct a message of each role: they pin the `role`
// discriminant and you fill in the rest (`assistantMessage({ content })`).
export { assistantMessage, systemMessage, toolMessage, userMessage } from "./types";

// Multimodal content parts for a user turn (text / image / audio / file) + their
// factories, plus `contentToText` to flatten a part array for display/logging.
export { audioPart, contentToText, filePart, imagePart, textPart } from "./types";

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

export { ToolRegistry } from "./tools/registry";

// Skills: a named bundle of instructions + tools the model pulls in on demand.
// Composition over the existing seams — the catalog goes in `system`, the tools
// in `tools`, and disclosure rides the tool seam (`skillTool`). The loop is
// untouched, exactly like ToolRegistry.
export { SkillRegistry } from "./skills/registry";
export { skillResourceTool, skillTool } from "./skills/skill-tool";
export type { Skill, SkillResource } from "./skills/skills.types";

// Built-in tools: SDK-owned wiring over capability seams the consumer MUST
// implement (no host-binding backend is shipped — that is the consumer's, and
// the correct security boundary). Mocks live in `./mocks`, imported by tests.
export { formatShellResult, shellTool } from "./tools/builtin/shell";
export { codeExecutionTool, formatCodeExecutionResult } from "./tools/builtin/code-execution";
export { formatSearchResults, searchTool } from "./tools/builtin/search";
export { formatFileContent, formatGlobMatches, globTool, readTool } from "./tools/builtin/file-read";
export { editTool, formatEditResult, formatWriteResult, writeTool } from "./tools/builtin/file-write";
export { formatWebFetchResult, formatWebSearchResults, webFetchTool, webSearchTool } from "./tools/builtin/web";
export { browserTools, formatBrowserSnapshot } from "./tools/builtin/browser";
export type {
  BrowserElement,
  BrowserSession,
  BrowserSnapshot,
  CodeExecutionBackend,
  CodeExecutionRequest,
  CodeExecutionResult,
  FileEditRequest,
  FileEditResult,
  FileReadBackend,
  FileReadRequest,
  FileReadResult,
  FileWriteBackend,
  FileWriteRequest,
  FileWriteResult,
  GlobQuery,
  SearchBackend,
  SearchMatch,
  SearchQuery,
  ShellBackend,
  ShellResult,
  WebBackend,
  WebFetchRequest,
  WebFetchResult,
  WebSearchQuery,
  WebSearchResult,
} from "./tools/builtin/builtin.types";

// Planning tools: fully shipped (pure in-memory, no host binding), with a
// swappable store seam for persistence — the `Memory`/`SessionMemoryStore`
// shape, not the must-implement shape of the host-binding backends above.
export { InMemoryScratchpad, scratchpadTools } from "./tools/builtin/scratchpad";
export type { Scratchpad } from "./tools/builtin/scratchpad";
export {
  formatTodoList,
  InMemoryTodoStore,
  RETRY_LIMIT,
  TODO_STATUSES,
  todoListTools,
} from "./tools/builtin/todo-list";
export type { TodoItem, TodoStatus, TodoStore } from "./tools/builtin/todo-list";

export { all, any, maxSteps, not, whenToolCalled } from "./stop/conditions";
export type { StopCondition, StopContext } from "./stop/conditions.types";

export {
  withMemoryListeners,
  withMemoryNamespace,
  withModelGate,
  withModelObserver,
  type ModelGate,
} from "./compose";

export {
  injectReasoningKwargs,
  reasoningKwargsFor,
  reasoningProfileFor,
} from "./providers/reasoning-kwargs";
export type { ReasoningProfile, ThinkingMode } from "./providers/reasoning-kwargs";

export { prepareRequestMessages, runAgent } from "./primitives/loop";
export type {
  GateDecision,
  Hooks,
  RunAgentOptions,
  RunResult,
  ToolGateRequest,
  ToolResultOverride,
} from "./primitives/loop";

export { MessageQueue } from "./primitives/message-queue";
export type { DrainMode, MessageQueueOptions } from "./primitives/message-queue";

export { withCredentials } from "./credentials/with-credentials";
export { InMemoryCredentialStore } from "./credentials/in-memory-credential-store";
export type { InMemoryCredentialStoreOptions } from "./credentials/in-memory-credential-store";
export type { CredentialStore } from "./credentials/credentials.types";

export { permissionGate } from "./permissions/permission-gate";
export { InMemoryPermissionStore } from "./permissions/in-memory-permission-store";
export type {
  InMemoryPermissionStoreOptions,
  SettablePolicy,
} from "./permissions/in-memory-permission-store";
export type {
  ApprovalPrompter,
  ApprovalRequest,
  PermissionStore,
} from "./permissions/permissions.types";
export { ApprovalChoice, PermissionPolicy } from "./permissions/permissions.types";

// Observability: a passive Tracer that records a run's trajectory off the
// existing event/model/SSE seams, plus the async batched writer it uses for I/O.
export { Tracer } from "./observability/tracer";
export type { FormatOptions, TraceDocument, TracerOptions } from "./observability/tracer";
export { AsyncWriter } from "./observability/async-writer";
export type { AsyncWriterOptions } from "./observability/async-writer";
// Reconstruct a runnable curl from a captured request body (see `onRawRequest`).
export { toCurl } from "./observability/to-curl";
export type { ToCurlOptions } from "./observability/to-curl";
export type {
  CompactEntry,
  DisclosureStep,
  RawRequest,
  RawSSE,
  RequestSnapshot,
  TraceEntry,
  TraceMeta,
  TraceSource,
  TrajectoryStep,
  TrajectoryTool,
} from "./observability/tracer.types";
