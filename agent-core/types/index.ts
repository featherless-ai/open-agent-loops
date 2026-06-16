/**
 * Core message vocabulary shared across the agent loop, memory, and model
 * client. Intentionally provider-agnostic: nothing here references a specific
 * LLM SDK so that every seam (model, memory, tools) stays swappable.
 *
 * Split by concept into one file per cluster — see each module:
 * - {@link Role} (roles)
 * - {@link ToolCall}, {@link ToolCallType}, {@link ToolArguments} (tool-calls)
 * - {@link FinishReason} (finish-reason)
 * - {@link ReasoningDetail} and friends (reasoning)
 * - {@link Message} (message)
 * - {@link AgentEvent} and friends (events)
 *
 * This barrel re-exports them all, so `import { … } from "../types"` keeps
 * resolving exactly as it did when this was a single file.
 *
 * @module
 */

export * from "./roles";
export * from "./tool-calls";
export * from "./finish-reason";
export * from "./reasoning";
export * from "./message";
export * from "./events";
