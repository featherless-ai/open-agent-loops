/**
 * The {@link Message} union and its role narrowing guards.
 *
 * @remarks
 * `Message` is a discriminated union on {@link Role} — one variant per role, each
 * in its own file ({@link UserMessage}, {@link SystemMessage},
 * {@link AssistantMessage}, {@link ToolMessage}), all extending
 * {@link MessageBase}. The fields a turn may legally carry live in the type
 * rather than in prose: constructing a message tells you exactly which fields
 * apply, and reading a role-specific field requires narrowing first (a `role`
 * check, or the {@link isAssistantMessage} / {@link isToolMessage} guards).
 *
 * Modeling messages as a union mirrors how the OpenAI SDK itself types them — a
 * union of role-specific shapes, not one wide object.
 *
 * @module
 */

import type { AssistantMessage } from "./assistant-message";
import { Role } from "./roles";
import type { SystemMessage } from "./system-message";
import type { ToolMessage } from "./tool-message";
import type { UserMessage } from "./user-message";

/**
 * A single conversation message — one of {@link UserMessage},
 * {@link SystemMessage}, {@link AssistantMessage}, or {@link ToolMessage},
 * discriminated by its `role`.
 *
 * @remarks
 * Narrow before reading a role-specific field: `if (message.role === Role.Tool)`,
 * or the {@link isAssistantMessage} / {@link isToolMessage} guards (handy for
 * `array.filter(isToolMessage)`).
 *
 * @group Messages & Events
 */
export type Message = UserMessage | SystemMessage | AssistantMessage | ToolMessage;

/**
 * Narrow a {@link Message} to an {@link AssistantMessage}.
 *
 * @param message - The message to test.
 * @returns `true` (narrowing the type) when the message is an assistant turn.
 * @group Messages & Events
 */
export function isAssistantMessage(message: Message): message is AssistantMessage {
  return message.role === Role.Assistant;
}

/**
 * Narrow a {@link Message} to a {@link ToolMessage}.
 *
 * @param message - The message to test.
 * @returns `true` (narrowing the type) when the message is a tool-result turn.
 * @group Messages & Events
 */
export function isToolMessage(message: Message): message is ToolMessage {
  return message.role === Role.Tool;
}
