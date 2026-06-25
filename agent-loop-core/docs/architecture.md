# agent-loop-core — architecture

A **lightweight agent SDK**. The design is one thin core engine (`runAgent`)
that depends only on a small set of **extension seams** (interfaces). Built-in
implementations satisfy those seams; consumers plug in their own. Nothing in the
core is bound to a specific LLM provider or storage.

> The Mermaid below renders on GitHub and is the source of truth. For an
> **interactive, node-based** version, run the docs app (`npm run dev`) and open
> [`/architecture`](http://localhost:3000/architecture) — built with Vue Flow.

## SDK architecture (layered)

```mermaid
flowchart TB
    subgraph Consumer["Consumer application"]
        APP["your code (Nuxt route, service, CLI...)"]
    end

    subgraph SDK["agent-loop-core · lightweight SDK"]
        direction TB

        subgraph API["Public API — index.ts"]
            RUN["runAgent()"]
            DEF["defineTool()"]
            STOPS["stop: maxSteps / whenToolCalled / any"]
        end

        subgraph CORE["Core engine — primitives/loop.ts"]
            LOOP["agent loop: stream then run tools then persist then check stop"]
            EVT["event sink (observability / UI streaming)"]
        end

        subgraph SEAMS["Extension seams — interfaces"]
            MC["ModelClient (streams)"]
            MEM["Memory"]
            TOOL["Tool"]
            STOP["StopCondition"]
            HOOK["Hooks"]
        end

        subgraph BUILTIN["Built-in implementations — v1"]
            FAKE["MockModelClient (streaming, scriptable)"]
            INMEM["SessionMemoryStore"]
        end
    end

    subgraph PLUG["Pluggable later — not in v1"]
        OAI["OpenAI-compatible model"]
        ANTH["Anthropic / other models"]
        DUR["JSONL / Redis / Vector memory"]
    end

    APP --> RUN
    APP --> DEF
    RUN --> LOOP
    LOOP --> EVT
    LOOP --> MC
    LOOP --> MEM
    LOOP --> TOOL
    LOOP --> STOP
    LOOP --> HOOK

    FAKE -. implements .-> MC
    INMEM -. implements .-> MEM
    OAI -. implements .-> MC
    ANTH -. implements .-> MC
    DUR -. implements .-> MEM
```

**Reading it:** the core engine only ever calls the **interfaces** in the seams
layer. v1 ships `MockModelClient` + `SessionMemoryStore`; future providers/stores are
just new implementations of the same seams — the core never changes.

## Composition over inheritance

There is **no inheritance** in the SDK — no `extends`, no `super`, no abstract
base classes. You add capability by **building**, **wrapping**, and **injecting**
plain functions/objects, never by subclassing.

```mermaid
flowchart LR
    subgraph Implement["1 - implement a seam inline (no class, no factory)"]
        FN["const model: ModelClient = { stream }"]
        OBJ["const memory: Memory = { load, append, clear }"]
    end
    subgraph Wrap["2 - wrap to add behavior (decorator, not subclass)"]
        FN --> DEC["withModelObserver"]
        OBJ --> DEC2["withMemoryNamespace"]
    end
    subgraph Combine["2b - combine predicates"]
        SC["StopCondition"] --> CMB["any / all / not"]
    end
    subgraph Inject["3 - inject (compose into options)"]
        DEC --> OPT["RunAgentOptions"]
        DEC2 --> OPT
        CMB --> OPT
        TOOLS["Tool[]"] --> OPT
        OPT --> RUN["runAgent()"]
    end
```

- **Implement** — a seam is just an object/function that satisfies the
  interface (`{ stream }`, `{ load, append, clear }`). No base class, no factory
  wrapper. (`defineTool` is the one helper kept — purely so TypeScript infers
  the Zod schema into `execute`'s args, the same role as `defineConfig`.)
- **Wrap** — decorators like `withModelObserver` / `withMemoryNamespace` add
  behavior by *enclosing* an existing seam and forwarding to it. Want logging +
  namespacing? Wrap twice. (Classes such as `MockModelClient` implement an
  interface — `..|>` — but extend nothing.)
- **Combine** — stop conditions compose with `any` / `all` / `not`.
- **Inject** — everything meets at `RunAgentOptions`, the single composition
  point handed to `runAgent`.

## Runtime flow

```mermaid
flowchart LR
    A["prompt"] --> B["memory.load"]
    B --> C{"stream assistant via ModelClient"}
    C -->|no tool calls| F["final answer"]
    C -->|tool calls| D["validate then run Tools (parallel / sequential)"]
    D --> E["append results to Memory"]
    E --> G{"stop? terminate / stopWhen / maxSteps"}
    G -->|no| C
    G -->|yes| F
```

## Type/OOP detail (class diagram)

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

    class MockModelClient {
        +List~ModelRequest~ requests
        +stream(req) ModelStream
    }
    class SessionMemoryStore {
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
        +List~Tool~ tools
        +StopCondition stopWhen
        +Hooks hooks
    }
    class RunResult {
        +List~Message~ messages
        +number steps
    }

    MockModelClient ..|> ModelClient
    SessionMemoryStore ..|> Memory
    runAgent ..> ModelClient : streams
    runAgent ..> Memory : load / append
    runAgent ..> Tool : dispatches
    runAgent ..> StopCondition : evaluates
    runAgent ..> Hooks : invokes
    runAgent ..> RunResult : returns
    RunAgentOptions o-- ModelClient
    RunAgentOptions o-- Memory
    RunAgentOptions o-- Tool
```
