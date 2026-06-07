/**
 * The stop-condition seam. Stop conditions decide when the loop should end
 * early, independent of the natural stop (the model produces a turn with no
 * tool calls) and the hard `maxSteps` safety cap. They compose, so callers can
 * mix several — see the combinators in `./conditions`.
 */

import type { Message } from "../types";

export interface StopContext {
  /** 1-based count of model turns taken so far in this run. */
  step: number;
  /** The assistant message produced this turn. */
  assistant: Message;
  /** Tool-result messages produced this turn (empty if no tools ran). */
  toolResults: Message[];
  /** Full working history at this point. */
  messages: Message[];
}

export type StopCondition = (ctx: StopContext) => boolean | Promise<boolean>;
