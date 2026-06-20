/**
 * Tool-call wire shapes: the function-call a model requests, and the parsed
 * argument form handed to observers and the gate.
 *
 * @module
 */

/**
 * The kind of tool call.
 *
 * @remarks
 * The OpenAI chat-completions format defines exactly one value, `"function"`; a
 * single-member string enum keeps the call sites named while serializing to
 * that same wire string.
 *
 * @group Messages & Events
 */
export enum ToolCallType {
  /** A function tool call — the only kind the wire format defines. */
  Function = "function",
}

/**
 * A tool invocation requested by the model.
 *
 * @remarks
 * The OpenAI chat-completions wire shape verbatim: `{ id, type, function: {
 * name, arguments } }`, where `arguments` is a JSON *string* (not a parsed
 * object). The loop JSON-parses and schema-validates it before the tool runs.
 *
 * Abstraction over — nothing added: every field is OpenAI's, so a `ToolCall`
 * *is* the wire object. It rides as one element of an assistant turn's
 * {@link AssistantMessage.tool_calls} array.
 *
 * @example Wire shape (one element of `assistant.tool_calls[]`)
 * ```json
 * {
 *   "id": "call_abc123",
 *   "type": "function",
 *   "function": {
 *     "name": "get_weather",
 *     "arguments": "{\"city\":\"NYC\",\"units\":\"metric\"}"
 *   }
 * }
 * ```
 *
 * @see {@link ToolArguments}
 * @group Messages & Events
 */
export interface ToolCall {
  /** Unique id for this call, used to match the answering tool result. */
  id: string;
  /** The call kind; always {@link ToolCallType.Function}. */
  type: ToolCallType.Function;
  /** The function name and its raw argument string. */
  function: {
    /** Name of the tool/function to invoke. */
    name: string;
    /** Arguments as a JSON string, exactly as the model emitted them. */
    arguments: string;
  };
}

/**
 * Tool-call arguments *parsed* into an object.
 *
 * @remarks
 * The form handed off to observers, hooks, and the gate (the wire form on
 * {@link ToolCall.function | ToolCall.function.arguments} is a JSON string).
 * Always an object: function-calling schemas are JSON Schema objects, so parsed
 * arguments are keyed values. The value types aren't known at the loop level
 * (each tool has its own schema), hence `unknown` per key — a tool's own
 * `execute` gets them fully typed as `z.infer<schema>`.
 *
 * Abstraction over — `JSON.parse(toolCall.function.arguments)`. Not a wire type
 * of its own: the wire carries the *string* on {@link ToolCall.function}; this is
 * that string parsed, on its way to a tool's `execute`.
 *
 * @example From the wire string to a parsed `ToolArguments`
 * ```jsonc
 * // on the wire — ToolCall.function.arguments is a JSON *string*:
 * "{\"city\":\"NYC\",\"units\":\"metric\"}"
 * // parsed into a ToolArguments object:
 * { "city": "NYC", "units": "metric" }
 * ```
 *
 * @group Messages & Events
 */
export type ToolArguments = Record<string, unknown>;
