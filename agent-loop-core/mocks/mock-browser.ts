/**
 * A scriptable `BrowserSession` for tests — the browser counterpart to
 * {@link MockModelClient}.
 *
 * @remarks
 * This is a testing utility. A real {@link BrowserSession} binds to a live
 * browser, so the core ships none; this mock stands in for one the same way
 * {@link MockShellBackend} stands in for a real shell.
 *
 * Because a session is stateful, the responder is given the {@link BrowserAction}
 * just performed, so a test can script a small state machine — navigate returns
 * page A, a click on it returns page B — rather than one fixed page. Every action
 * is also recorded in {@link actions} for assertions.
 *
 * @module
 */

import type { ToolContext } from "../tools/tools.types";
import type { BrowserSession, BrowserSnapshot } from "../tools/builtin/builtin.types";

/**
 * One action performed against a {@link MockBrowserSession} — what gets recorded
 * and handed to a function responder.
 *
 * @group Testing
 */
export type BrowserAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; ref: string }
  | { kind: "type"; ref: string; text: string };

/**
 * The responder driving a {@link MockBrowserSession}: either a fixed snapshot
 * returned for every action, or a function that decides per action.
 *
 * @group Testing
 */
export type BrowserResponder =
  | BrowserSnapshot
  | ((action: BrowserAction) => BrowserSnapshot);

/** Default blank page returned when no responder is supplied. */
const BLANK: BrowserSnapshot = { url: "about:blank", title: "", elements: [] };

/**
 * Scriptable {@link BrowserSession} that records actions and replays snapshots.
 *
 * @remarks
 * This is a testing utility. Every action is captured in {@link actions} —
 * including `ctx`, so tests can verify the loop forwarded the abort signal. The
 * resulting page comes from the {@link BrowserResponder} supplied at construction.
 *
 * @example
 * ```ts
 * const session = new MockBrowserSession((action) =>
 *   action.kind === "navigate"
 *     ? { url: action.url, title: "Home", elements: [{ ref: "e1", role: "link", name: "Next" }] }
 *     : { url: "https://site/next", title: "Next", elements: [] },
 * );
 * const home = await session.navigate("https://site", ctx);
 * expect(home.elements[0]?.ref).toBe("e1");
 * expect(session.actions).toHaveLength(1);
 * ```
 *
 * @see {@link MockModelClient}
 * @see {@link MockShellBackend}
 * @group Testing
 */
export class MockBrowserSession implements BrowserSession {
  /** Every (action, ctx) performed, in order — handy for assertions. */
  readonly actions: Array<{ action: BrowserAction; ctx: ToolContext }> = [];

  /**
   * @param responder - A fixed snapshot or a per-action function. Defaults to a blank page.
   */
  constructor(private readonly responder: BrowserResponder = BLANK) {}

  /**
   * Record the navigation and return the scripted page.
   * @param url - The URL issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The snapshot from the responder.
   */
  async navigate(url: string, ctx: ToolContext): Promise<BrowserSnapshot> {
    return this.run({ kind: "navigate", url }, ctx);
  }

  /**
   * Record the click and return the scripted page.
   * @param ref - The element ref issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The snapshot from the responder.
   */
  async click(ref: string, ctx: ToolContext): Promise<BrowserSnapshot> {
    return this.run({ kind: "click", ref }, ctx);
  }

  /**
   * Record the typing and return the scripted page.
   * @param ref - The element ref issued by the tool.
   * @param text - The text issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The snapshot from the responder.
   */
  async type(ref: string, text: string, ctx: ToolContext): Promise<BrowserSnapshot> {
    return this.run({ kind: "type", ref, text }, ctx);
  }

  /** Record an action and resolve the responder against it. */
  private run(action: BrowserAction, ctx: ToolContext): BrowserSnapshot {
    this.actions.push({ action, ctx });
    return typeof this.responder === "function" ? this.responder(action) : this.responder;
  }
}
