# Advance Agent

Minimal Nuxt 3 + Vercel AI SDK starter for shipping an interactive
internal-app to the Featherless app store. Boots a chat UI that streams
from any OpenAI-compatible endpoint (defaults to
`api.featherless.ai/v1`).

## What's in here

| Layer | Files |
|---|---|
| Platform | `app.yaml`, `Dockerfile`, `entrypoint.sh`, `.gitlab-ci.yml`, `app-icon.svg` |
| Nuxt | `package.json`, `nuxt.config.ts`, `tsconfig.json`, `.gitignore` |
| App code | `app.vue`, `pages/index.vue`, `server/api/chat.post.ts`, `server/api/health.get.ts` |
| Bootstrap | `platform_scripts/bootstrap.sh` (rewrite slug/name when forking) |

## Local dev

```sh
cp .env.example .env  # fill in your FEATHERLESS_API_KEY
bun install
bun run dev
# → http://localhost:3000
```

## Forking this as a new app

```sh
gh repo create my-org/my-app --template featherless-ai/advance-agent --clone
cd my-app
./platform_scripts/bootstrap.sh --slug my-app --name "My Cool App"
git push origin main
```

Then add the app via the Featherless admin form, supplying the GitLab
project path. CI will build and publish
`docker.io/featherlessai/my-app:0.0.1` on the first `v0.0.1` tag.

## Production build

The Dockerfile produces a Nitro server output at
`.output/server/index.mjs`. `entrypoint.sh` binds it to
`$SANDBOX_SERVICE_PORT` (the port the Featherless platform proxies; 3000
in practice). For local container runs:

```sh
docker build -t advance-agent:dev .
docker run -e FEATHERLESS_API_KEY=rc_... \
           -e SANDBOX_SERVICE_PORT=3000 \
           -p 3000:3000 \
           advance-agent:dev
```

## How env vars reach the app

`app.yaml` declares three fields the admin form captures
(`featherlessModel`, `featherlessApiKey`, `featherlessApiBaseUrl`) and
maps them via `envTemplate` to `FEATHERLESS_MODEL`,
`FEATHERLESS_API_KEY`, `FEATHERLESS_API_BASE_URL`. The platform injects
these into the running container at boot, and Nuxt's
`useRuntimeConfig()` reads them server-side at request time. No
client-side env-var bundling, no `/runtime-config` bridge needed.

## Releasing

The standard `release.sh` from feather-agent works here — drop it in
`platform_scripts/` after forking, or invoke manually:

```sh
git tag -a v0.0.2 -m "Bug fix"
# bump appVersion in app.yaml to 0.0.2 in the same commit
git push origin main v0.0.2
```

GitLab CI builds + publishes the image. The Featherless platform pulls
the new image on next sandbox launch.
