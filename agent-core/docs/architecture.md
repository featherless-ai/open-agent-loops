# agent-core — architecture

OOP view of the core. Every dependency points at an **interface** (`ModelClient`,
`Memory`, `Tool`, `StopCondition`, `Hooks`), which is what makes each piece
plug-and-play. `runAgent` is the orchestrator; it owns no concrete provider.

> GitHub renders the diagram below directly. For an interactive page, open
> [`architecture.html`](./architecture.html) in a browser, or paste the block
> into <https://mermaid.live>.

```mermaid
classDiagram
    direction LR

    class ModelClient {
        <<interface>>
        +stream(req) ModelStream
    }
    class Memory {
        <<interface>>
        +load(sessionId) List~Message~
        +append(sessionId, messages)
        +clear(sessionId)
    }
    class Tool~S~ {
        <<interface>>
        +string name
        +string description
        +ZodType parameters
        +string executionMode
        +execute(args, ctx) ToolResult
    }
    class StopCondition {
        <<type>>
        +call(ctx) boolean
    }
    class Hooks {
        <<interface>>
        +transformContext(messages) List~Message~
        +beforeToolCall(info) Decision
        +afterToolCall(info) Override
    }

    class FakeModelClient {
        +List~ModelRequest~ requests
        -Script script
        +stream(req) ModelStream
    }
    class InMemoryStore {
        -Map sessions
        +load(sessionId) List~Message~
        +append(sessionId, messages)
        +clear(sessionId)
    }

    class runAgent {
        <<function>>
        +runAgent(options) RunResult
    }

    class RunAgentOptions {
        +ModelClient model
        +Memory memory
        +string sessionId
        +Prompt prompt
        +List~Tool~ tools
        +number maxSteps
        +StopCondition stopWhen
        +Hooks hooks
    }
    class RunResult {
        +List~Message~ messages
        +List~Message~ newMessages
        +number steps
    }

    class Message {
        +Role role
        +string content
        +List~ToolCall~ toolCalls
        +string toolCallId
        +bool isError
    }
    class ToolCall {
        +string id
        +string name
        +object arguments
    }
    class ToolResult {
        +string content
        +unknown details
        +bool terminate
    }
    class ModelRequest {
        +string system
        +List~Message~ messages
        +List~ToolSpec~ tools
    }
    class StreamEvent {
        <<union>>
        +text_delta
        +tool_call
        +done
        +error
    }
    class AgentEvent {
        <<union>>
        +agent_start
        +turn_start
        +message
        +tool_start
        +tool_end
        +agent_end
    }

    FakeModelClient ..|> ModelClient
    InMemoryStore ..|> Memory

    runAgent ..> ModelClient : streams
    runAgent ..> Memory : load / append
    runAgent ..> Tool : dispatches
    runAgent ..> StopCondition : evaluates
    runAgent ..> Hooks : invokes
    runAgent ..> RunAgentOptions : input
    runAgent ..> RunResult : output
    runAgent ..> AgentEvent : emits

    RunAgentOptions o-- ModelClient
    RunAgentOptions o-- Memory
    RunAgentOptions o-- Tool
    RunAgentOptions o-- Hooks
    RunAgentOptions o-- StopCondition

    ModelClient ..> ModelRequest : consumes
    ModelClient ..> StreamEvent : yields
    Memory ..> Message : stores
    Tool ..> ToolResult : returns
    Tool ..> ToolCall : validates
    Message o-- ToolCall
    RunResult o-- Message
```

## Reading guide

- `..|>` **implements** — `FakeModelClient`/`InMemoryStore` are swappable
  implementations of their interfaces.
- `..>` **depends on / uses** — `runAgent` only ever depends on interfaces.
- `o--` **aggregates** — `RunAgentOptions` is the wiring point where you plug
  concrete implementations in.

## The runtime flow

```mermaid
flowchart LR
    A[prompt] --> B[memory.load]
    B --> C{stream assistant<br/>via ModelClient}
    C -->|no tool calls| F[final answer]
    C -->|tool calls| D[validate + run Tools<br/>parallel / sequential]
    D --> E[append results to Memory]
    E --> G{stop?<br/>terminate / stopWhen / maxSteps}
    G -->|no| C
    G -->|yes| F
```
