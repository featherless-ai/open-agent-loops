/**
 * The plan-as-code workflow seam.
 *
 * @remarks
 * An agent *authors* a workflow as ordinary TypeScript (the deterministic
 * skeleton — sequence, branch, parallel, loops); the executor runs that fixed
 * code against a small runtime API whose primitives delegate to
 * {@link runAgent | runAgent} (the non-deterministic LLM nodes).
 *
 * Authored code is the body of an `async (wf, input) => result` function: it
 * receives the {@link WorkflowRuntime} as `wf` and the caller's `input`, and
 * returns whatever the workflow produces. The control flow *around*
 * `wf.step(...)` calls is frozen once authored; only the steps themselves stay
 * non-deterministic.
 *
 * @module
 */

/**
 * Options for one non-deterministic node: a single {@link runAgent | runAgent} call.
 *
 * @see {@link WorkflowRuntime.step} which consumes these options.
 * @group Workflow
 */
export interface StepOptions {
  /** The prompt for this step's agent run. */
  prompt: string;
  /** Optional system prompt scoping the step. */
  system?: string;
  /**
   * Tool *names* this step may use, resolved from the executor's registry.
   * Names (not objects) because authored code is a string and can't reference
   * real `Tool` instances.
   */
  tools?: string[];
  /** Hard safety cap on this step's model turns. Defaults to the executor's. */
  maxSteps?: number;
}

/**
 * The API authored workflow code is written against.
 *
 * @remarks
 * Each `step` is an LLM node; `parallel` fans steps out; `log` is
 * observability. The deterministic skeleton is the plain JS/TS control flow the
 * author writes *around* these calls — that surrounding code is frozen once
 * authored, while the steps themselves remain non-deterministic.
 *
 * @example
 * ```ts
 * // Authored workflow body: async (wf, input) => { ... }
 * const draft = await wf.step("draft", {
 *   prompt: `Draft a short blog post about: ${input}`,
 *   system: "You are a concise technical writer.",
 *   tools: ["search"],
 * });
 *
 * // Fan two independent reviews out concurrently.
 * const [copyEdit, factCheck] = await wf.parallel([
 *   () => wf.step("copy-edit", { prompt: `Copy-edit:\n${draft}` }),
 *   () => wf.step("fact-check", { prompt: `Fact-check:\n${draft}`, tools: ["search"] }),
 * ]);
 *
 * wf.log("reviews complete; merging");
 * return { draft, copyEdit, factCheck };
 * ```
 *
 * @see {@link StepOptions} for the per-step configuration.
 * @see {@link WorkflowFn} for the compiled callable this API is bound into.
 * @group Workflow
 */
export interface WorkflowRuntime {
  /**
   * Run one LLM step; resolves to its final text answer.
   *
   * @param name - Label for this step, used in logs and observability.
   * @param options - The prompt, optional system prompt, tools, and step cap.
   * @returns The step agent's final text answer.
   */
  step(name: string, options: StepOptions): Promise<string>;
  /**
   * Run several thunks concurrently; resolves to their results in order.
   *
   * @typeParam T - The result type each thunk resolves to.
   * @param thunks - Functions to invoke concurrently; typically each calls {@link step}.
   * @returns The thunks' results, in the same order as `thunks`.
   */
  parallel<T>(thunks: Array<() => Promise<T>>): Promise<T[]>;
  /**
   * Emit a progress note for observers (does not affect control flow).
   *
   * @param message - The note to surface to observers.
   */
  log(message: string): void;
}

/**
 * A compiled workflow: the authored body as a callable function.
 *
 * @param wf - The {@link WorkflowRuntime} the authored code calls into.
 * @param input - The caller's input, forwarded to the authored body.
 * @returns Whatever the workflow produces.
 * @see {@link CompileWorkflow} which produces values of this type.
 * @see {@link WorkflowRuntime} for the API the body is written against.
 * @group Workflow
 */
export type WorkflowFn = (wf: WorkflowRuntime, input: unknown) => Promise<unknown>;

/**
 * Turn authored source (the body of `async (wf, input) => { ... }`) into a callable.
 *
 * @remarks
 * SANDBOX SEAM: the default implementation (`defaultCompile`) uses
 * `AsyncFunction`, which restricts the code's named parameters to `wf`/`input`
 * but still shares the host global scope — it is NOT a security boundary. Swap
 * in a real sandbox (vm/worker/isolate) when running untrusted authored code.
 *
 * @param code - The authored function body as source text.
 * @returns A {@link WorkflowFn} that runs the authored body.
 * @see {@link WorkflowFn} for the callable this produces.
 * @group Workflow
 */
export type CompileWorkflow = (code: string) => WorkflowFn;
