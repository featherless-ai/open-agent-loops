/**
 * The kitchen-sink assistant — one agent wired with the batteries that compose
 * cleanly. This file is the whole point of the example: a tour of how the seams
 * stack on top of `runAgent` without the loop ever changing.
 *
 * Batteries wired here:
 *  - Model + reasoning kwargs ....... OpenAICompatibleModel({ thinking: "on" })
 *  - Model decorator ................ withModelObserver (stream-error logging)
 *  - Observability .................. Tracer (onRawRequest/onRequest → curls())
 *  - Memory + decorator ............. SessionMemoryStore + withMemoryListeners
 *  - Steering / follow-up ........... MessageQueue + drainSteering/drainFollowUp
 *  - Built-in tools ................. shellTool + searchTool (real node backends)
 *  - Planning tools ................. todoListTools + scratchpadTools
 *  - Credentials .................... withCredentials (secret never seen by model)
 *  - Multi-agent .................... agentAsTool (a "researcher" sub-agent)
 *  - Skills ......................... SkillRegistry + skillTool (on-demand)
 *  - Permissions .................... permissionGate (read-only allow; else ask)
 *  - Stop conditions ................ maxSteps cap + any(whenToolCalled("finish"))
 *
 * Alternatives NOT wired (they are top-level *drivers*, not composable seams):
 * runGoal (outer goal loop) and Dispatcher/ChannelBridge (multi-session). See
 * the README.
 */
import {
  agentAsTool,
  any,
  ApprovalChoice,
  defineTool,
  InMemoryCredentialStore,
  InMemoryScratchpad,
  InMemoryTodoStore,
  InMemoryPermissionStore,
  MessageQueue,
  permissionGate,
  PermissionPolicy,
  scratchpadTools,
  searchTool,
  SessionMemoryStore,
  shellTool,
  SkillRegistry,
  skillTool,
  StreamEventType,
  todoListTools,
  Tracer,
  userMessage,
  whenToolCalled,
  withCredentials,
  withMemoryListeners,
  withModelObserver,
} from "@open-agent-loops/core";
import type { ApprovalPrompter, Memory, ModelClient, RunAgentOptions } from "@open-agent-loops/core";
// The model classes are subpath-only exports (the barrel ships the core API; the
// implementations live behind ./providers/openai and ./mocks/mock-model).
import { OpenAICompatibleModel } from "@open-agent-loops/core/providers/openai";
import { MockModelClient } from "@open-agent-loops/core/mocks/mock-model";
import { nodeSearchBackend, nodeShellBackend } from "./node-backends";
import { researchSkill } from "./skills";
import { z } from "zod";

/** What `createAssistant` returns: a per-prompt run-config factory + the tracer. */
export interface Assistant {
  /** Build the `runAgent` config (minus `onEvent`) for one prompt + session. */
  runConfigFor(prompt: string, sessionId: string): Omit<RunAgentOptions, "onEvent">;
  /** The shared tracer — exposes `curls()` for the "copy as curl" endpoint. */
  tracer: Tracer;
  /**
   * Queue a *steering* message for a session's in-flight run. The loop drains it
   * after the next turn's tool results (pairing intact) and injects it, redirecting
   * the run even past a `terminate`/`stopWhen` — see `hooks.drainSteering`. A no-op
   * on the model if no run is active; it simply waits in the queue for the next one.
   */
  steer(sessionId: string, text: string): void;
  /**
   * Queue a *follow-up* message for a session. The loop drains it only when the run
   * would otherwise stop at a natural final answer, continuing it in place (one
   * trace) — see `hooks.drainFollowUp`.
   */
  followUp(sessionId: string, text: string): void;
}

/**
 * A no-API-key model (`MOCK=1`). It's a *function* script, not a fixed array, so
 * it serves unlimited requests: one shared instance handles every chat turn of
 * every session. It decides from the request itself — if the turn already has a
 * tool result, answer; otherwise call the shell once. (An array script would run
 * off its end after the first request, since callIndex is global to the client.)
 */
function mockModel(): ModelClient {
  return new MockModelClient((request) => {
    const sawToolResult = request.messages.some((m) => m.role === "tool");
    if (sawToolResult) {
      return { text: "All set — the shell printed `kitchen-sink-ok`. What would you like to do?" };
    }
    return {
      reasoning: "Let me verify the environment with a quick shell command.",
      text: "Running a quick check.",
      toolCalls: [{ name: "shell", arguments: { command: "echo kitchen-sink-ok" } }],
    };
  });
}

export function createAssistant(opts: { mock?: boolean } = {}): Assistant {
  // ── Observability: a passive tracer tapped onto the model boundary. ──────────
  const tracer = new Tracer();

  // ── Model: reasoning on, with the tracer tapping the raw request wire so
  //    `tracer.curls()` can reconstruct a runnable curl for any turn. ──────────
  const base: ModelClient = opts.mock
    ? mockModel()
    : new OpenAICompatibleModel({
        apiKey: process.env.LLM_API_KEY,
        baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
        // DeepSeek V4 tool-calls cleanly; GLM emits broken empty-key tool args.
        model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
        thinking: "on",
        onRawRequest: tracer.onRawRequest,
        onRequest: tracer.onRequest,
      });

  // Decorator: tee every stream event (here, just surface stream errors).
  const model = withModelObserver(base, (e) => {
    if (e.type === StreamEventType.Error) console.error("[model] stream error:", e.error);
  });

  // ── Memory: one store across turns, wrapped to log every append. ────────────
  const memory: Memory = withMemoryListeners(new SessionMemoryStore(), {
    onAppend: (id, messages) => console.log(`[memory] +${messages.length} msg(s) → ${id}`),
  });

  // ── Steering / follow-up: per-session pull-queues the loop drains at its
  //    boundaries. The loop only ever *pulls* (drainSteering after each turn's
  //    tools → redirects a live run; drainFollowUp when a run would end → keeps
  //    it going in place). These maps are the caller-owned queues it pulls from,
  //    keyed by sessionId so a push from the steer route reaches the right run. ─
  const steeringQueues = new Map<string, MessageQueue>();
  const followUpQueues = new Map<string, MessageQueue>();
  const queueFor = (queues: Map<string, MessageQueue>, sessionId: string): MessageQueue => {
    let q = queues.get(sessionId);
    if (!q) {
      q = new MessageQueue();
      queues.set(sessionId, q);
    }
    return q;
  };

  // ── Built-in tools on real host backends (the consumer fills the seam). ─────
  const shell = shellTool(nodeShellBackend());
  const search = searchTool(nodeSearchBackend());

  // ── Planning tools (fully-shipped batteries; pure in-memory stores). ────────
  const todos = new InMemoryTodoStore();
  const scratch = new InMemoryScratchpad();
  const planning = [...todoListTools(todos), ...scratchpadTools(scratch)];

  // ── Credentials: the model references a secret by placeholder; the real
  //    value is spliced in for one call and scrubbed from the output. ──────────
  const credentials = new InMemoryCredentialStore({
    secrets: { api_token: process.env.DEMO_API_TOKEN ?? "sk-demo-SECRET-do-not-log" },
  });
  const httpGet = withCredentials(
    defineTool({
      name: "http_get",
      description:
        'Describe an authorized GET. Pass the token as the placeholder "Bearer {{api_token}}" — never a real secret.',
      parameters: z.object({
        url: z.string().describe("The URL to fetch."),
        authorization: z.string().describe('Authorization header, e.g. "Bearer {{api_token}}".'),
      }),
      // Demo only: don't really call out — echo what *would* be sent. The echoed
      // secret is scrubbed by withCredentials before the model ever sees it.
      execute: ({ url, authorization }) => ({
        content: `Would GET ${url} with Authorization: ${authorization}`,
      }),
    }),
    credentials,
  );

  // ── Multi-agent: a researcher sub-agent exposed as a tool. Context-isolated
  //    by default (fresh session per call), returns only its final answer. ─────
  const researcher = agentAsTool({
    name: "researcher",
    description: "Delegate a self-contained research question about this repo; returns a concise summary.",
    model,
    system: "You are a meticulous researcher. Ground claims in the repo via search. Answer concisely.",
    tools: [search, shell],
    maxSteps: 6,
  });

  // ── Skills: an on-demand instruction+tool bundle. ───────────────────────────
  const skills = new SkillRegistry([researchSkill]);

  // ── A tiny completion signal so the stop seam has something to fire on. ─────
  const finish = defineTool({
    name: "finish",
    description: "Call when the user's request is fully handled, to end the run.",
    parameters: z.object({ summary: z.string().describe("One-line summary of what was done.") }),
    execute: ({ summary }) => ({ content: `Done: ${summary}` }),
  });

  // ── Permissions: read-only + planning auto-allowed; anything else asks. The
  //    web has no synchronous human prompt in v1, so the prompter auto-approves
  //    and logs. Swapping in an interactive requires-action flow is the HITL
  //    extension (see README). ─────────────────────────────────────────────────
  const permissions = new InMemoryPermissionStore({
    fallback: PermissionPolicy.Ask,
    rules: {
      search: PermissionPolicy.Allow,
      todo_list: PermissionPolicy.Allow,
      todo_append: PermissionPolicy.Allow,
      todo_update: PermissionPolicy.Allow,
      researcher: PermissionPolicy.Allow,
      http_get: PermissionPolicy.Allow,
      finish: PermissionPolicy.Allow,
    },
  });
  const prompter: ApprovalPrompter = {
    async ask(batch) {
      return batch.map(({ toolCall, args }) => {
        console.log(`[permissions] auto-approving ${toolCall.function.name}(${JSON.stringify(args)})`);
        return ApprovalChoice.AllowOnce;
      });
    },
  };
  const gate = permissionGate(permissions, prompter);

  // ── Tools + system prompt (with the skill catalog). ─────────────────────────
  const tools = [shell, search, ...planning, httpGet, researcher, finish, skillTool(skills), ...skills.tools()];

  const system = [
    "You are a capable assistant wired with many tools, exposed over a web UI.",
    "Plan multi-step work with the todo_* tools; jot intermediate notes with the scratchpad.",
    "Use `search` to ground answers in the local repository and `shell` for commands.",
    "Delegate self-contained research to the `researcher` sub-agent.",
    "When the request is fully handled, call `finish` with a one-line summary.",
    "",
    "## Available skills",
    skills.catalog(),
    "Call the `skill` tool with a skill name to load its instructions before using it.",
  ].join("\n");

  return {
    tracer,
    steer(sessionId, text) {
      console.log(`[steer] queued for ${sessionId}: ${JSON.stringify(text)}`);
      queueFor(steeringQueues, sessionId).push(userMessage({ content: text }));
    },
    followUp(sessionId, text) {
      console.log(`[follow-up] queued for ${sessionId}: ${JSON.stringify(text)}`);
      queueFor(followUpQueues, sessionId).push(userMessage({ content: text }));
    },
    runConfigFor(prompt, sessionId) {
      return {
        model,
        memory,
        sessionId,
        prompt,
        system,
        tools,
        // Stop seam: a hard safety cap, OR an explicit completion signal.
        maxSteps: 12,
        stopWhen: any(whenToolCalled("finish")),
        hooks: {
          gateToolCalls: gate,
          // Pull-seams: the loop drains these per-session queues at its boundaries.
          drainSteering: () => queueFor(steeringQueues, sessionId).drain(),
          drainFollowUp: () => queueFor(followUpQueues, sessionId).drain(),
        },
      };
    },
  };
}
