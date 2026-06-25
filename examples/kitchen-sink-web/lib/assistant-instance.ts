/**
 * The one assistant per process, shared by every route.
 *
 * Both the chat route (`/api/assistant`) and the steer route
 * (`/api/assistant/steer`) import THIS instance, so per-session state — memory
 * AND the steering/follow-up queues, all keyed by sessionId — is the same object
 * whichever route you hit. A steering message pushed by the steer route therefore
 * reaches the run an earlier chat request started.
 *
 * No API key → a scripted mock model (the README's zero-config dev path). We warn
 * when falling back so a *missing* key in production isn't silent; set `MOCK=1` to
 * select the mock deliberately (no warning).
 */
import { createAssistant } from "./agent";

const explicitMock = process.env.MOCK === "1";
const missingKey = !process.env.LLM_API_KEY;
if (missingKey && !explicitMock) {
  console.warn("[assistant] LLM_API_KEY not set — falling back to the scripted mock model.");
}

export const assistant = createAssistant({ mock: explicitMock || missingKey });
