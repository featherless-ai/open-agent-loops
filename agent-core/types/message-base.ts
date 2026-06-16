/**
 * Fields shared by every conversation message, regardless of role.
 *
 * @module
 */

/**
 * Fields common to every message. Each role variant — {@link UserMessage},
 * {@link SystemMessage}, {@link AssistantMessage}, {@link ToolMessage} — extends
 * this and adds its own `role` discriminant plus any role-specific fields.
 *
 * @group Messages & Events
 */
export interface MessageBase {
  /** The turn's text content. */
  content: string;
  /** [extension — not in the OpenAI spec] Creation time (ms since epoch), for ordering. */
  timestamp?: number;
}
