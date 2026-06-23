# Team Notes — Open Agent Loops

A tiny knowledge base the `researcher` sub-agent greps in steps 3–4.

## The loop
- The agent loop lives in `agent-core/primitives/loop.ts`.
- One run: load history → append prompt → [ stream assistant → run tools ]* → done.
- It stops on a turn with no tool calls, a tool that sets `terminate`, a `stopWhen`
  condition, or the `maxSteps` safety cap.

## Sub-agents
- `agentAsTool` wraps an agent as a tool another agent can call.
- Each call runs in its own isolated session by default; only the final answer
  returns to the caller, so the parent's context stays clean.

## Channels
- `ChannelBridge` connects a live transport (Slack/Discord) to `runAgent`.
- A bounded buffer between the socket and the loop provides backpressure.

## Reasoning
- A per-model lookup table maps a model id to its thinking toggle kwargs.
- The loop drops reasoning from plain turns but resends it on tool-call turns.
