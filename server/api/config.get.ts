// Public config exposed to the browser. Pulled from process.env at request
// time, so any env var the platform injects via app.yaml.envTemplate is
// available immediately — no Nuxt runtimeConfig bridge, no rebuild needed.
//
// Only put values here that are SAFE to send to the browser. The API key
// MUST NOT be exposed; chat requests go through /api/chat which holds the
// key server-side.
export default defineEventHandler(() => ({
  defaultModel: process.env.FEATHERLESS_MODEL ?? 'zai-org/GLM-5.1',
}));
