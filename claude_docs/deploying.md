---
title: Deploying & Publishing
description: Host the docs site on a Cloudflare subdomain via a cloudflared tunnel, and publish the package to npm so anyone can install it.
---

There are two things to ship:

1. **The docs site** (this site) — onto a Cloudflare `*.featherless.ai` subdomain.
2. **The package** (`@open-agent-loops/agent-loop-core`) — onto npm, so anyone can `npm install` it.

The Cloudflare half follows the same shape the Featherless **guarded-api Cloudflare
pilot** uses: a containerized Node service bound to localhost, reached from the
outside through a `cloudflared` tunnel. No inbound ports, no DNS-to-IP record, and
Cloudflare terminates TLS for you.

## Part 1 — Host the docs on a Cloudflare subdomain

### The shape

```
browser ──https://docs.featherless.ai──▶ Cloudflare DNS
                                             │  tunnel (outbound only — no open ports)
                                             ▼
                        ┌──── one always-on host (VM / droplet / Fly) ────┐
                        │  cloudflared                                     │
                        │      │  http://localhost:3000                    │
                        │      ▼                                           │
                        │  docs container  (next start, port 3000)         │
                        └──────────────────────────────────────────────────┘
```

### Prerequisites

- An always-on host with Docker (a small VM, a droplet, a Fly machine).
- Access to the Cloudflare account that owns the **`featherless.ai` zone** — to
  create the tunnel and route the `docs` hostname.
- The build is **not** self-contained inside `docs-fuma/`: the codegen reads
  `../examples/**` (snippet materialization) and runs TypeDoc over
  `../agent-loop-core/index.ts` (API reference). So the Docker **build context must be
  the repo root**, not `docs-fuma/`.

> **⚠️ Warning** — Steps 4–5 (the tunnel + DNS route) must be run by whoever holds
> the `featherless.ai` Cloudflare zone. Everything before that (Steps 1–3) you can
> do and verify locally; the tunnel is the only piece that needs zone access.

### 1. Build & run the docs container

The docs site is a Next.js **server** app (it serves a live `/api/search` route),
so it runs as a container with `next start` rather than a static export.

Add a `Dockerfile` at the **repo root**:

```dockerfile
# Build context = repo root: the docs codegen reads ../examples and ../agent-loop-core.
FROM node:20-slim AS build
WORKDIR /app
RUN npm i -g bun
COPY . .
WORKDIR /app/docs-fuma
RUN bun install --frozen-lockfile
# `bun run build` runs the sidebar (TypeDoc) + snippets codegen, then `next build`.
RUN bun run build

FROM node:20-slim AS runtime
WORKDIR /app/docs-fuma
ENV NODE_ENV=production PORT=3000
RUN npm i -g bun
COPY --from=build /app/docs-fuma ./
EXPOSE 3000
CMD ["bun", "run", "start"]   # next start, on PORT
```

Build and run it, binding to loopback so only the tunnel can reach it:

```bash
# from the repo root
docker build -t open-agent-loops-docs .

docker run -d --name open-agent-loops-docs --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  open-agent-loops-docs

curl -s localhost:3000 | head    # the rendered docs HTML
```

> **ℹ️ Leaner image (optional).** Set `output: "standalone"` in
> `docs-fuma/next.config.mjs`, then copy only `.next/standalone`, `.next/static`,
> and `public/` into the runtime stage and run `node server.js`. It trims the image
> substantially; the simple `next start` above is the boring, always-works default.

### 2. Create the Cloudflare tunnel

```bash
cloudflared tunnel login                          # browser auth to the featherless.ai zone
cloudflared tunnel create open-agent-loops-docs      # prints a UUID + writes a credentials JSON
cloudflared tunnel route dns open-agent-loops-docs docs.featherless.ai
```

Write `cloudflared/config.yml` pointing the hostname at the container:

```yaml
tunnel: <UUID-from-create>
credentials-file: /root/.cloudflared/<UUID>.json

ingress:
  - hostname: docs.featherless.ai
    service: http://localhost:3000
  - service: http_status:404      # catch-all — required last rule
```

### 3. Run the tunnel

```bash
cloudflared tunnel --config cloudflared/config.yml run
# or install it as a service: `cloudflared service install`
```

`https://docs.featherless.ai` is now live with Cloudflare's TLS. Nothing to renew.

### Gate it (optional)

To keep the site private, put **Cloudflare Access (Zero Trust)** in front of the
hostname: **Zero Trust → Access → Applications → Add a self-hosted application**,
enter `docs.featherless.ai`, then add an **Allow** policy (e.g. *emails ending in*
`@featherless.ai`). Access authenticates at Cloudflare's edge before any request
reaches the container — no code change. The free plan covers 50 seats.

### Alternative: Cloudflare Containers + Worker

Instead of a host + `cloudflared`, the same image can run in a **Cloudflare
Container** fronted by a **Worker** (deployed with `wrangler deploy`), giving a
`*.workers.dev` URL or a custom domain — no VM to keep alive. This mirrors the
`worker/` setup in the guarded-api pilot; reach for it if you'd rather not run a
host.

### Tearing it down

```bash
docker rm -f open-agent-loops-docs
cloudflared tunnel delete open-agent-loops-docs   # also removes the DNS route
```

## Part 2 — Publish the package to npm

This publishes `@open-agent-loops/agent-loop-core` to npm — **private (restricted) at first**,
then public when you're ready.

### Pre-flight

- It's a **scoped** package (`@open-agent-loops/agent-loop-core`), and scoped packages publish
  as **restricted (private)** by default — exactly what we want initially. We set
  it explicitly below so it can't be made public by accident, and flip it to
  public later in one command.
- `files: ["dist"]` means **only `dist/` ships** — examples, tests, and the docs
  site are excluded.
- `prepublishOnly` runs `bun run build` (tsup) before publish, so `dist/` is
  always fresh. You don't build by hand.
- Bump off `0.0.1` for a real release.

### 1. Keep it private (restricted)

Scoped packages are already restricted by default; set it explicitly in
`package.json` so a stray `--access public` can't leak it:

```jsonc
{
  "publishConfig": {
    "access": "restricted"
  }
}
```

> **⚠️ Warning** — npm **private (restricted) packages require a paid plan** — npm
> Pro, Teams, or an org with private packages. On a free account, publishing a
> restricted scoped package is rejected; either upgrade, or publish to a private
> registry such as **GitHub Packages** instead. Going public later has no such
> requirement.

### 2. Bump the version

```bash
npm version 0.1.0     # writes package.json + a git tag
```

### 3. Authenticate

```bash
npm login             # interactive; needs an npm account with publish rights to the @open-agent-loops scope
```

For CI, use an **automation access token** (`NPM_TOKEN`) instead of interactive
login — it bypasses 2FA prompts.

### 4. Publish

```bash
npm publish           # restricted by `publishConfig.access`; prepublishOnly builds dist/ first
# (or, matching the repo's tooling: `bun publish`)
```

### 5. Verify

```bash
npm view @open-agent-loops/agent-loop-core version      # the version you just shipped
```

While the package is restricted, only the publisher and anyone granted access to
the `@open-agent-loops` scope can install it — and they must be `npm login`'d first.

### When you're ready to go public

Flip visibility in one command — no republish needed:

```bash
npm access public @open-agent-loops/agent-loop-core
```

(Or change `publishConfig.access` to `"public"` so future versions publish public
by default.) From then on, the install below works for **anyone**:

```bash
npm install @open-agent-loops/agent-loop-core
# Using the OpenAI-compatible provider? add the optional peer dep:
npm install openai
```

`zod` ships as a regular dependency, so it comes along automatically. The package
exposes three entry points: the root (`.`), `./mocks/mock-model`, and
`./providers/openai`.

### Optional: publish from CI on a tag

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Tag a release (`git tag v0.1.0 && git push --tags`) and CI publishes it — the same
"whoever owns the account runs the deploy" split as the Cloudflare half.
