/**
 * The plan-as-code workflow seam. An agent *authors* a workflow as ordinary
 * TypeScript (the deterministic skeleton — sequence, branch, parallel, loops);
 * the executor runs that fixed code against a small runtime API whose primitives
 * delegate to `runAgent` (the non-deterministic LLM nodes).
 *
 * Authored code is the body of an `async (wf, input) => result` function: it
 * receives the `WorkflowRuntime` as `wf` and the caller's `input`, and returns
 * whatever the workflow produces. The control flow *around* `wf.step(...)` calls
 * is frozen once authored; only the steps themselves stay non-deterministic.
 */

/** Options for one non-deterministic node: a single `runAgent` call. */
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
 * The API authored workflow code is written against. Each `step` is an LLM node;
 * `parallel` fans steps out; `log` is observability. The deterministic skeleton
 * is the plain JS/TS control flow the author writes around these calls.
 */
export interface WorkflowRuntime {
  /** Run one LLM step; resolves to its final text answer. */
  step(name: string, options: StepOptions): Promise<string>;
  /** Run several thunks concurrently; resolves to their results in order. */
  parallel<T>(thunks: Array<() => Promise<T>>): Promise<T[]>;
  /** Emit a progress note for observers (does not affect control flow). */
  log(message: string): void;
}

/** A compiled workflow: the authored body as a callable function. */
export type WorkflowFn = (wf: WorkflowRuntime, input: unknown) => Promise<unknown>;

/**
 * Turn authored source (the body of `async (wf, input) => { ... }`) into a
 * callable. This is the SANDBOX SEAM: the default implementation
 * (`defaultCompile`) uses `AsyncFunction`, which restricts the code's named
 * parameters to `wf`/`input` but still shares the host global scope — it is NOT
 * a security boundary. Swap in a real sandbox (vm/worker/isolate) when running
 * untrusted authored code.
 */
export type CompileWorkflow = (code: string) => WorkflowFn;
