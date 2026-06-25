# Giving tools the skill treatment (progressive disclosure for tools)

> Status: instructions / design sketch. The Level-3 resource seam already exists
> for **skills** (`Skill.resources` + `skillResourceTool`, shipped with tests in
> `__tests__/skills-resources.test.ts`). This is how to give **tools** the same
> treatment. Part 1 is a clean, no-loop-change copy of the skill seam; Part 2 is
> the bigger, more invasive half — flagged honestly.

## The mapping

A skill discloses in three levels. A tool already pays for the first; the other
two are what we can add:

| Level | Skill | Tool today | Tool with the treatment |
|---|---|---|---|
| **L1** name + summary, always in context | `description` in `skills.catalog()` | `name` + `description` (always sent) | unchanged |
| **L2** full body on demand | `instructions` via `skill` tool | the full **JSON schema**, sent *every turn* | disclose the spec on demand (Part 2) |
| **L3** bundled reference on demand | `resources` via `skill_resource` tool | crammed into `description`, or not carried at all | **`tool_resource` (Part 1)** |

The win is the same as for skills: a tool can carry a large reference (a query
DSL, a format spec, an enum table, examples) that **never enters context, or even
gets read, until the model actually needs it** — instead of bloating the tool's
`description` on every turn.

---

## Part 1 — Tool resources (Level 3). The direct, no-loop-change win.

This is a near-verbatim copy of what `skillResourceTool` already does. Follow the
shipped skill code as the template at every step.

### 1. Reuse the resource shape

`SkillResource` (`skills/skills.types.ts`) is already generic — `{ description,
load() }`. Promote it to a shared type so tools and skills share one definition:

- Move `SkillResource` to e.g. `tools/resource.types.ts` as `Resource`
  (`{ description: string; load(): string | Promise<string> }`).
- Re-export it as `SkillResource` for back-compat, and use `Resource` for tools.

The load thunk is the whole point: it runs **only** when the resource is loaded,
so an unused resource costs nothing — not even the read.

### 2. Attach resources to tools — without touching the loop

Two options; pick by how strict you are about the core `Tool` seam:

- **A (symmetric with skills):** add an optional field to `Tool`:
  ```ts
  resources?: Record<string, Resource>;
  ```
  This is low-risk — `Tool` already carries optional fields the loop ignores
  (`executionMode?`), and the loop never reads `resources`. Resources live right
  next to the tool that owns them, exactly like `Skill.resources`.

- **B (loop-purist):** keep `Tool` untouched and hold a side map
  `toolName -> Record<string, Resource>` in a small `ToolResourceRegistry`
  (mirror `SkillRegistry`). Composition only; the core seam never changes.

Recommend **A** — the symmetry with skills is worth more than keeping one extra
optional field off the interface, and it stays inert to the loop either way.

### 3. Add the `tool_resource` disclosure tool

Copy `skillResourceTool` almost verbatim (`skills/skill-tool.ts`). It is the same
shape, fail-fast and all:

```ts
export function toolResourceTool(registry: ToolRegistry): Tool {
  return defineTool({
    name: "tool_resource",
    description:
      "Load a named reference bundled with a tool (a format spec, query DSL, examples). " +
      "Returns its content; call it when a tool's description points you to one.",
    parameters: z.object({
      tool: z.string().describe("The tool that owns the resource."),
      name: z.string().describe("The resource to load, by name."),
    }),
    execute: async ({ tool: toolName, name }) => {
      const tool = registry.get(toolName);              // ToolRegistry already resolves name -> tool
      if (!tool) throw new Error(`Unknown tool "${toolName}". Available: ${registry.names().join(", ")}.`);
      const resource = tool.resources?.[name];          // (option A) or registry-side map (option B)
      if (!resource) {
        const have = Object.keys(tool.resources ?? {}).join(", ") || "(none)";
        throw new Error(`Tool "${toolName}" has no resource "${name}". Available: ${have}.`);
      }
      return { content: await resource.load() };
    },
  });
}
```

(`ToolRegistry` already exists and resolves names → tools, so unlike skills you
don't need a new registry for option A — reuse it.)

### 4. Advertise resources cheaply

The model has to learn a resource *exists* without paying for its body. Mirror the
manifest `skillTool` appends: when a tool has resources, append a one-line-each
manifest to the tool's `description` (names + descriptions only):

```
... <the tool's normal description> ...

Resources (load with `tool_resource`): reference: the widget format; examples: 3 worked queries.
```

A small `withResourceManifest(tool)` decorator (in the `with*` family) can do this
so authors don't hand-write it — it reads `tool.resources` and rewrites
`description`. Bodies stay lazy; only names + summaries are ever in context.

### 5. Tests + exports

- Copy `__tests__/skills-resources.test.ts` → `__tests__/tool-resources.test.ts`:
  lazy `load()` (not called until `tool_resource` runs), manifest contains
  names not bodies, fail-fast on unknown tool/resource, and an e2e through
  `runAgent` + `MockModelClient` proving the body stays out of context until
  loaded.
- Export `toolResourceTool` and the shared `Resource` type from `index.ts`.

That is the entire Level-3 treatment, and like the skill version it is **pure
composition — the loop is untouched.**

---

## Part 2 — Disclose the tool *spec* on demand (Levels 1–2). Bigger; not free.

The real per-turn cost isn't a tool's reference material — it's the **full JSON
schema of every tool, sent on every request**. With dozens of tools that
dominates the prompt. The skill answer (cheap catalog up front, full body via a
`skill` tool) maps onto tools as **lazy tool loading**:

1. **A cheap tool catalog** in the system prompt — `name: description` lines, like
   `skills.catalog()`. Build it from a `ToolRegistry`.
2. **A `tool` discloser** that returns a tool's full description + JSON schema
   when the model asks (`tool({ name })`), and marks it "active".
3. **Gate the heavy tools until disclosed** with the existing `gateToolCalls`
   hook — a `toolGate(activeSet)` that blocks a tool's calls until its
   `tool({name})` has run. This is exactly the `skillGate` idea from
   `skills.md`, applied to plain tools, and it needs **no loop change** because
   gating is already a hook.

### The honest caveat

Steps 1–3 hide a tool's *schema* from the model only if the tool's spec isn't in
the `tools` array to begin with — but the loop takes a **static `tools` array** by
design. So there are two flavors, with a real tradeoff:

- **Gate-only (no loop change):** advertise all specs as today, but *gate
  execution* until `tool({name})` runs. You save nothing on prompt size — you only
  add an "arm before firing" step. Cheap, but not the disclosure win.
- **True spec-hiding (bends the rule):** keep heavy tools *out* of the advertised
  set and inject their spec when disclosed. That requires the advertised tool set
  to change mid-run, which the static `tools` array doesn't currently allow —
  you'd thread the active set through `transformContext`/the request build, or add
  a "dynamic tools" seam. This is the one place the treatment stops being free.

So: **ship Part 1 now** (it's the same clean seam skills already have). Treat
Part 2 as a deliberate design decision — gate-only is a quick add; real
schema-hiding is a loop feature to scope on its own.

---

## Staging

1. **Shared `Resource` type + `toolResourceTool` + tests.** Mirrors skills L3,
   no loop change. Ships the bundled-reference win on its own.
2. **`withResourceManifest` decorator + an example** (a tool whose big format spec
   becomes a lazily-loaded resource).
3. **(Optional) Tool-spec progressive disclosure** — catalog + `tool` discloser +
   `toolGate` over `gateToolCalls`. Decide gate-only vs. a dynamic-tools seam
   first.
