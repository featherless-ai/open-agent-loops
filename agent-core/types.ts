/**
 * Core message vocabulary shared across the agent loop, memory, and model
 * client. Intentionally provider-agnostic: nothing here references a specific
 * LLM SDK so that every seam (model, memory, tools) stays swappable.
 */

export type Role = "system" | "user" | "assistant" | "tool";

/** A tool invocation requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * A single conversation message. One shape covers user/assistant/tool turns:
 * - assistant turns may carry `toolCalls`
 * - tool-result turns set `toolCallId` / `toolName` / `isError`
 */
export interface Message {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
}

/** Events emitted by the loop for observability / streaming to a UI. */
export type AgentEvent =
  | { type: "agent_start"; sessionId: string }
  | { type: "turn_start"; step: number }
  | { type: "text_delta"; text: string }
  | { type: "message"; message: Message }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_end";
      toolCallId: string;
      toolName: string;
      result: string;
      isError: boolean;
    }
  | { type: "agent_end"; messages: Message[]; steps: number };

export type EventSink = (event: AgentEvent) => void | Promise<void>;
