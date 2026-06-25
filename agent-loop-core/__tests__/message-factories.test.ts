import { describe, expect, it } from "bun:test";

import { assistantMessage, systemMessage, toolMessage, userMessage } from "../types";
import { Role, ToolCallType } from "../types";

describe("message factories", () => {
  it("userMessage pins the role and keeps the supplied fields", () => {
    expect(userMessage({ content: "hi", timestamp: 5 })).toEqual({
      role: Role.User,
      content: "hi",
      timestamp: 5,
    });
  });

  it("systemMessage pins the role", () => {
    expect(systemMessage({ content: "you are a bot", timestamp: 5 })).toEqual({
      role: Role.System,
      content: "you are a bot",
      timestamp: 5,
    });
  });

  it("toolMessage carries the required tool_call_id plus optional fields", () => {
    expect(toolMessage({ content: "result", tool_call_id: "c1", toolName: "search", isError: true, timestamp: 5 })).toEqual({
      role: Role.Tool,
      content: "result",
      tool_call_id: "c1",
      toolName: "search",
      isError: true,
      timestamp: 5,
    });
  });

  it("assistantMessage carries reasoning and tool calls when supplied", () => {
    const tool_calls = [{ id: "c1", type: ToolCallType.Function, function: { name: "x", arguments: "{}" } }];
    expect(assistantMessage({ content: "", reasoning: "thinking", tool_calls, timestamp: 5 })).toEqual({
      role: Role.Assistant,
      content: "",
      reasoning: "thinking",
      tool_calls,
      timestamp: 5,
    });
  });

  it("defaults timestamp to the construction time when the caller omits it", () => {
    const before = Date.now();
    const message = userMessage({ content: "hi" });
    expect(typeof message.timestamp).toBe("number");
    expect(message.timestamp!).toBeGreaterThanOrEqual(before);
  });

  it("lets an explicit timestamp override the default", () => {
    expect(userMessage({ content: "hi", timestamp: 1 }).timestamp).toBe(1);
  });

  it("still omits fields the caller did not supply (only role + timestamp are defaulted)", () => {
    const message = assistantMessage({ content: "answer" });
    expect(message.role).toBe(Role.Assistant);
    expect(message.content).toBe("answer");
    expect("tool_calls" in message).toBe(false);
    expect("reasoning" in message).toBe(false);
  });
});
