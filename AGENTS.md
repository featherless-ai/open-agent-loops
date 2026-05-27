# AGENTS.md — using and adapting this starter

Read this before doing any of: cloning this repo into a new app,
running `bootstrap.sh`, wiring it into sandbox-svc's seeding flow, or
modifying the defaults developers will inherit.

The companion doc for humans is `README.md`. This file is the
**agent-facing** instruction set: what to do, when to do it, what to
check after.

---

## When to reach for this starter

- The user says: "scaffold a new internal-app", "give me a Nuxt
  template", "make a new Featherless app", "I need a UI-first agent".
- Or: an existing app needs to be migrated to Nuxt and you're looking
  for a known-working baseline.
- Or: someone is debugging why a freshly-scaffolded sandbox fails to
  launch — this repo is the reference for what a working sandbox looks
  like, end-to-end.

## When NOT to reach for it

- The app is server-only or CLI-based (no UI). Use
  `~/Desktop/featherless/agent-apps/nemo-claw/` (custom server) or
  `~/Desktop/featherless/agent-apps/hermes-agent-image/` (ttyd
  terminal) instead.
- The app needs persistent storage (sqlite, mongo, etc.). Start here,
  but be ready to add the storage layer; the starter has none.
- The app is in another language (Python, Go). This is TS/Bun-only —
  swap the runtime in Dockerfile and entrypoint.sh, or use a different
  starter entirely.

---

## `platform_scripts/bootstrap.sh` — fork this repo into a new app

### Purpose

Rewrites the starter's default `featherless-nuxt-starter` slug and
`Featherless Nuxt Starter` display name to a new app's slug/name, then
commits. Run this immediately after cloning so the new repo's
`package.json`, `app.yaml`, `Dockerfile`, `.gitlab-ci.yml`, and
`README.md` all reference the new identity.

### When to reach for it

- A developer asks: "fork this starter as my-new-app".
- You're standing up a new internal-app and have already cloned
  this repo into a fresh checkout.
- sandbox-svc is calling this as part of the Option C seeding flow
  (clone the starter → run bootstrap → push as new GitLab project).

### When NOT to reach for it

- The user wants to modify the starter *itself* (e.g. update its
  defaults). Edit files directly; don't run bootstrap.
- A previous bootstrap run already happened in this checkout. The
  script is idempotent but will produce an empty commit; check
  `git log -1 --oneline` first.

### Inputs

| name | required | notes |
|---|---|---|
| `--slug` | yes | lowercase, hyphenated, alphanumeric. Becomes the package name, Docker image name, and `app.yaml` slug. |
| `--name` | yes | human-readable display name. Becomes the `app.yaml` `name` and the page header. |
| `--no-commit` | no | skip the `git add -A && git commit` step. Useful when chaining with other scripts. |

### Clarifying questions to ask the user

1. **What's the slug?** If they gave a display name only, propose a
   slug (kebab-case of the name) and confirm before running.
2. **Is this a fresh clone?** If the working tree already shows
   non-default slugs, bootstrap won't find the literal strings to
   rewrite and will silently no-op. Tell the user.
3. **Do they want the commit?** Default behavior commits. If they want
   to review first, pass `--no-commit`.

### Invocation

```sh
./platform_scripts/bootstrap.sh --slug my-app --name "My App"
```

### What to verify after

- `grep -r "featherless-nuxt-starter" .` returns nothing (excluding
  `node_modules/` and `.git/`).
- `cat package.json | grep name` shows the new slug.
- `cat app.yaml | grep '^name:'` shows the new display name.
- `cat app.yaml | grep image:` shows
  `docker.io/featherlessai/<new-slug>:{{appVersion}}`.

### Gotchas

- **The script edits a fixed file list.** If you've added new files
  that reference the slug (e.g. a tool-server config), add them to the
  `FILES=()` array in the script before running, or do those rewrites
  by hand.
- **macOS sed vs. GNU sed.** The script handles both. Don't bypass it
  by running raw `sed -i` from agent calls.
- **The icon doesn't get rewritten.** `app-icon.svg` is reused as-is.
  The developer should replace it with their own art before shipping
  v1.0.0 if they want a distinct icon in the marketplace.

---

## `platform_scripts/release.sh` — bump appVersion, commit, tag, push

### Purpose

Ship a new version. Bumps `appVersion` in `app.yaml`, commits, pushes
`main`, creates an annotated `vX.Y.Z` tag, pushes the tag. GitLab CI
then builds and publishes the Docker image.

Copied verbatim from feather-agent's `platform_scripts/release.sh` —
the script is generic to any Featherless internal-app whose
`app.yaml` has a dotted-decimal `appVersion:` line.

### When to reach for it

The user says any of: "ship it", "release", "tag a new version", "bump
the version", "push a new build", "release a patch/minor/major",
"deploy". Also implicit: the user just finished a code change and
asked you to make it live in a deployed sandbox.

### When NOT to reach for it

- The change is dev tooling only (e.g. editing `platform_scripts/`
  itself, or a README). No image rebuild needed → commit and push
  manually, skip the version bump.
- The working tree has unrelated in-progress work the user hasn't
  decided about. The script bundles `git add -u` into the same commit
  as the version bump.
- You're not sure the change actually compiles / passes tests. The
  script doesn't run tests. Get a green local build first.

### Inputs

| name | type | required | notes |
|---|---|---|---|
| `bump_level` | `patch` \| `minor` \| `major` | yes | semver step from current `appVersion` |
| `message` | string | no | commit + tag message. Defaults to `Release vX.Y.Z`. |

### Clarifying questions to ask

1. **Which bump level?** Infer from the staged diff:
   - `patch` — bug fix, doc tweak, no consumer-visible change
   - `minor` — new feature, new env var, backwards-compatible addition
   - `major` — breaking change to API, env contract, or entrypoint
2. **Commit message?** Draft one from the staged diff if not given.
3. **Uncommitted work?** Check `git status` first. Tracked-modified
   files get bundled into the release commit; untracked files do not.
4. **Tag exists?** `git tag -l "v$NEXT"`. Surface before invoking.

### Invocation

```sh
./platform_scripts/release.sh <bump_level> "<message>"
```

### What to verify after

1. CI green (3 jobs: `build`, `publish:latest`, `publish:release`).
2. `featherlessai/<slug>:<X.Y.Z>` exists on Docker Hub.
3. A fresh sandbox spawn picks up the new tag (user-triggered).

### Gotchas

- **Doesn't watch CI.** Returns after `git push origin <tag>`. Poll
  via `glab ci list` if the user wants to be notified.
- **`app.yaml` couples `appVersion` to image tag.** A manual `git tag`
  without bumping `appVersion` is meaningless — sandbox-svc pulls the
  image at the `appVersion` literal.
- **Requires `INTERNAL_NPM_TOKEN` CI variable** if the app pulls
  `@featherless/*` packages. The starter doesn't today, so this is a
  non-issue unless you add private deps.
- **Don't release before a weekend** unless someone's around to fix CI
  if it fails.

### Failure modes

| Output | Cause | Fix |
|---|---|---|
| `appVersion in app.yaml is not X.Y.Z` | quoted or `appVersion: latest` | Normalize to `appVersion: 0.0.1`, re-run |
| `tag vX.Y.Z already exists` | partial prior release | Bump again, or `git tag -d` if junk |
| `no app.yaml at <root>` | wrong dir | `cd` to repo root |
| Pre-commit hook fail | lint/format issue | Fix the underlying issue. Never `--no-verify`. |

---

## How this fits into the Featherless seeding flow (Option C)

As of the design discussion on 2026-05-13, sandbox-svc's
scaffold endpoint (`POST /apps/scaffold`) renders 5 `.tmpl` files from
`agent-sandbox-service/api/scaffold/internal-app/`. That produces a
bash-stub starter, not a Nuxt one.

This repo is intended to be the source for an **Option C** seeding
path:

1. sandbox-svc receives a `framework=nuxt` flag (or similar) on the
   scaffold request.
2. sandbox-svc clones this repo (e.g. from a public mirror or a
   bundled tarball).
3. sandbox-svc runs `platform_scripts/bootstrap.sh --slug <slug>
   --name "<name>" --no-commit` inside the clone.
4. sandbox-svc commits the result as the initial commit of the new
   GitLab project, then pushes.

The bootstrap script is intentionally agnostic about whether it's
called by a human or by sandbox-svc — same inputs, same outputs.

If you're an agent asked to **implement the Option C wiring in
sandbox-svc**, see
`~/Desktop/featherless/agent-apps/feather-agent/platform_notes/scaffold-pr2-app-yaml-fields.md`
for the related app.yaml work, and check the e2e tests at
`agent-sandbox-service/test/e2e/apps-commit-yaml.e2e.test.ts` and
`test/utils/scaffold-loader.test.ts` for the existing test patterns.

---

## Adapting the starter (modifying it for everyone)

Edits here affect every future Featherless internal-app forked from
this repo. Be conservative.

Safe changes:
- Bumping dep versions in `package.json` (test that `bun install` +
  `bun run build` still succeeds).
- Adjusting the chat UI in `pages/index.vue`.
- Adding new Nitro routes under `server/api/`.

Risky changes (think twice):
- Changing the port (`3000` is the sandbox-svc convention — see
  `featherless-app-entrypoint-rule` auto-memory).
- Changing `app.yaml`'s `fields[]` block (developers can override
  per-app, but the defaults set the platform expectation).
- Changing `Dockerfile` away from `ENTRYPOINT` (will silently break
  Daytona auto-launch).
- Renaming `bootstrap.sh` (sandbox-svc Option C wiring depends on the
  path).

After a starter change, smoke-test:
```sh
./platform_scripts/bootstrap.sh --slug test-app --name "Test App" --no-commit
git diff   # verify the rewrite was clean
git checkout .   # restore for the next person
```
