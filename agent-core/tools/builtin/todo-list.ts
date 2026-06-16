/**
 * The `todo_append` / `todo_list` / `todo_update` tools: a task tracker that lets
 * the agent decompose long work and keep track of what is pending, in progress,
 * and done across many turns.
 *
 * @remarks
 * Pure in-memory state, so — like the scratchpad and unlike the host-binding
 * `ShellBackend` — the core ships a working default ({@link InMemoryTodoStore})
 * and the {@link TodoStore} seam is there only for extensibility (back it with a
 * file/DB to share a list across sessions).
 *
 * Error handling follows the project rule: structural violations (duplicate id,
 * unknown id, invalid status) **throw** from the store and propagate out of the
 * tool, so the loop marks the result `isError: true` with the message. Advisory
 * outcomes (a retry count, "nothing to update") are ordinary content the model
 * reads but should not treat as a failure.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import { ExecutionMode } from "../tools.types";

/**
 * The lifecycle states a {@link TodoItem} can be in.
 *
 * @group Planning Tools
 */
export const TODO_STATUSES = [
  "pending",
  "in_progress",
  "done",
  "cancelled",
  "failed",
] as const;

/**
 * A to-do status: one of {@link TODO_STATUSES}.
 *
 * @group Planning Tools
 */
export type TodoStatus = (typeof TODO_STATUSES)[number];

/**
 * How many times a failed task may be retried before the tool tells the agent to
 * stop and escalate to the user.
 *
 * @group Planning Tools
 */
export const RETRY_LIMIT = 3;

/**
 * A single to-do item.
 *
 * @group Planning Tools
 */
export interface TodoItem {
  /** Caller-chosen unique id, e.g. `"step-1"`. */
  id: string;
  /** What the task is. */
  content: string;
  /** Current lifecycle status. */
  status: TodoStatus;
  /** How many times this item has been retried (failed → in_progress). */
  retries: number;
}

/**
 * The to-do store seam — the state behind the three tools.
 *
 * @remarks
 * Swap the shipped {@link InMemoryTodoStore} for a file/DB-backed implementation
 * to persist or share a list. Structural violations throw; see the module remarks.
 *
 * @group Planning Tools
 */
export interface TodoStore {
  /**
   * Add a new item.
   * @throws `Error` if `status` is invalid or `id` already exists.
   */
  append(id: string, content: string, status: TodoStatus): TodoItem;
  /** Return the items; completed/cancelled are omitted unless `includeCompleted`. */
  read(includeCompleted: boolean): TodoItem[];
  /**
   * Update an item's content and/or status; moving `failed → in_progress`
   * increments its retry count.
   * @throws `Error` if `status` is invalid or no item has this `id`.
   */
  update(id: string, content: string | undefined, status: TodoStatus | undefined): TodoItem;
}

/**
 * In-memory {@link TodoStore} — the shipped default.
 *
 * @remarks
 * Holds the list in an array; every returned item is a copy, so callers cannot
 * mutate the store's state by reference. Rejects invalid statuses, duplicate ids,
 * and updates to unknown ids by throwing a descriptive error.
 *
 * @group Planning Tools
 */
export class InMemoryTodoStore implements TodoStore {
  private readonly items: TodoItem[] = [];

  append(id: string, content: string, status: TodoStatus): TodoItem {
    assertValidStatus(status);
    if (this.items.some((item) => item.id === id)) {
      throw new Error(`To-do item "${id}" already exists.`);
    }
    const item: TodoItem = { id, content, status, retries: 0 };
    this.items.push(item);
    return { ...item };
  }

  read(includeCompleted: boolean): TodoItem[] {
    const visible = includeCompleted
      ? this.items
      : this.items.filter((item) => item.status !== "done" && item.status !== "cancelled");
    return visible.map((item) => ({ ...item }));
  }

  update(
    id: string,
    content: string | undefined,
    status: TodoStatus | undefined,
  ): TodoItem {
    if (status !== undefined) assertValidStatus(status);
    const item = this.items.find((it) => it.id === id);
    if (!item) {
      throw new Error(`To-do item "${id}" not found.`);
    }
    if (content !== undefined) item.content = content;
    if (status !== undefined) {
      const previous = item.status;
      item.status = status;
      // A failed task moved back to in_progress is a retry attempt.
      if (previous === "failed" && status === "in_progress") item.retries += 1;
    }
    return { ...item };
  }
}

/**
 * Throw if `status` is not one of {@link TODO_STATUSES}.
 *
 * @remarks
 * The tools already constrain status with a Zod enum, so this only fires for
 * direct callers of the store (or a custom implementation) — defense in depth,
 * per the project's fail-fast rule.
 *
 * @internal
 */
function assertValidStatus(status: TodoStatus): void {
  if (!TODO_STATUSES.includes(status)) {
    throw new Error(
      `Invalid status "${status}". Valid statuses: ${TODO_STATUSES.join(", ")}.`,
    );
  }
}

/**
 * Build the `todo_append`, `todo_list`, and `todo_update` tools over a {@link TodoStore}.
 *
 * @remarks
 * All three run {@link ExecutionMode.Sequential}: they share one mutable list, so
 * a batch the model emits in a single turn applies in request order rather than
 * racing. The store's throws propagate so a structural violation surfaces as an
 * `isError` tool result the model can react to.
 *
 * @param store - The backing store. Defaults to a fresh {@link InMemoryTodoStore}.
 * @returns `[todo_append, todo_list, todo_update]`, ready for `runAgent` or a `ToolRegistry`.
 * @see {@link TodoStore}
 * @example
 * ```ts
 * const todos = new InMemoryTodoStore();
 * await runAgent({ ...opts, tools: todoListTools(todos) });
 * // todo_append({ id: "step-1", content: "Inspect repo", status: "pending" })
 * ```
 * @group Planning Tools
 */
export function todoListTools(store: TodoStore = new InMemoryTodoStore()): Tool[] {
  const append = defineTool({
    name: "todo_append",
    description:
      "Add a new item to your to-do list so you can track multi-step work. " +
      "Each id must be unique.",
    parameters: z.object({
      id: z.string().describe('A unique id for this item, e.g. "step-1".'),
      content: z.string().describe("What the task is."),
      status: z.enum(TODO_STATUSES).describe('Initial status; usually "pending".'),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: ({ id, content, status }) => {
      const item = store.append(id, content, status);
      return { content: `Added [${item.id}] "${item.content}" (${item.status}).` };
    },
  });

  const list = defineTool({
    name: "todo_list",
    description:
      "List your to-do items with a count per status. Completed and cancelled " +
      "items are hidden unless includeCompleted is true.",
    parameters: z.object({
      includeCompleted: z
        .boolean()
        .optional()
        .describe("Include done and cancelled items too. Defaults to false."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: ({ includeCompleted }) => ({
      content: formatTodoList(store.read(includeCompleted ?? false)),
    }),
  });

  const update = defineTool({
    name: "todo_update",
    description:
      "Update a to-do item's content and/or status. Moving an item from failed " +
      "back to in_progress counts as a retry.",
    parameters: z.object({
      id: z.string().describe("The id of the item to update."),
      content: z.string().optional().describe("New content; omit to leave unchanged."),
      status: z.enum(TODO_STATUSES).optional().describe("New status; omit to leave unchanged."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: ({ id, content, status }) => {
      if (content === undefined && status === undefined) {
        return { content: "Nothing to update — provide content and/or status." };
      }
      return { content: describeUpdate(store.update(id, content, status)) };
    },
  });

  return [append, list, update];
}

/**
 * Render a to-do list into the text block handed to the model: a header, a
 * per-status count line, then one line per item (with a retry note when > 0).
 *
 * @param items - The items to render, in list order.
 * @returns A human/model-readable summary of the list.
 * @see {@link todoListTools}
 * @group Planning Tools
 */
export function formatTodoList(items: TodoItem[]): string {
  const header = `To-do list (${items.length} item${items.length === 1 ? "" : "s"})`;
  const counts = TODO_STATUSES.map(
    (status) => `${items.filter((item) => item.status === status).length} ${status}`,
  ).join(", ");
  if (items.length === 0) return `${header}\n${counts}`;
  const lines = items.map((item) => {
    const retryNote = item.retries > 0 ? `, ${item.retries} retries` : "";
    return `- [${item.id}] ${item.content} (${item.status}${retryNote})`;
  });
  return `${header}\n${counts}\n-----\n${lines.join("\n")}`;
}

/**
 * Build the advisory message for a successful update — including the retry-budget
 * guidance when a failed task is being retried.
 *
 * @internal
 */
function describeUpdate(item: TodoItem): string {
  if (item.status === "in_progress" && item.retries > 0) {
    if (item.retries >= RETRY_LIMIT) {
      return (
        `Updated [${item.id}] to in_progress — retry ${item.retries} of ${RETRY_LIMIT} ` +
        `(retry limit reached). Do not retry again; escalate to the user instead.`
      );
    }
    return `Updated [${item.id}] to in_progress (retry ${item.retries} of ${RETRY_LIMIT}).`;
  }
  return `Updated [${item.id}] (${item.status}).`;
}
