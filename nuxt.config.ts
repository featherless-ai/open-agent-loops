export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  modules: ['@nuxt/ui'],
  css: ['~/assets/main.css'],
  // No runtimeConfig block by design — env vars are read directly via
  // process.env in server routes (server/api/*.ts). This means any env var
  // the platform injects from app.yaml.envTemplate is immediately available
  // with zero Nuxt-side wiring (no NUXT_* bridge in entrypoint.sh, no
  // build-time vs runtime gotchas). For values that need to reach the
  // browser, expose them via a server route (see server/api/config.get.ts).
});
