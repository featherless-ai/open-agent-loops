#!/usr/bin/env bash
# bootstrap.sh — rewrite the starter's default slug/name to a new app's
# slug/name. Designed to be called from two places:
#
#   1. By a developer who cloned this repo locally:
#        ./platform_scripts/bootstrap.sh --slug my-app --name "My App"
#
#   2. By sandbox-svc as part of the Option C clone-instead-of-render
#      seeding flow: clone this repo into a fresh checkout, run this
#      script, then push the result as the new GitLab project.
#
# What it rewrites (find/replace across tracked files):
#   - `featherless-nuxt-starter`           → <new-slug>
#   - `Featherless Nuxt Starter`           → <new-name>
#
# Both terms appear in a small set of files: package.json, app.yaml,
# Dockerfile, .gitlab-ci.yml, README.md, server/api/health.get.ts.
# Nothing else uses the literal slug, so the rewrite is targeted.
#
# After rewrite, the script optionally runs `git add -A && git commit`
# with a clear message so the result is push-ready.

set -euo pipefail

SLUG=""
NAME=""
COMMIT=1

usage() {
  cat <<EOF >&2
usage: $0 --slug <slug> --name "<name>" [--no-commit]

  --slug       new app slug (lowercase, hyphenated). e.g. my-cool-app
  --name       new app display name. e.g. "My Cool App"
  --no-commit  rewrite files only; skip git add+commit
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --no-commit) COMMIT=0; shift ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done

[[ -z "$SLUG" || -z "$NAME" ]] && usage

if [[ ! "$SLUG" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "error: --slug must be lowercase, hyphenated, alphanumeric (got: '$SLUG')" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# Detect sed flavor for in-place edits (BSD/macOS vs GNU).
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(sed -i)
else
  SED_INPLACE=(sed -i '')
fi

# Files that mention the slug or name. Keep this list explicit so we don't
# accidentally clobber unrelated files (e.g. node_modules) if someone runs
# this after `bun install`.
FILES=(
  package.json
  app.yaml
  Dockerfile
  .gitlab-ci.yml
  README.md
  server/api/health.get.ts
)

for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || continue
  "${SED_INPLACE[@]}" -e "s|featherless-nuxt-starter|${SLUG}|g" "$f"
  "${SED_INPLACE[@]}" -e "s|Featherless Nuxt Starter|${NAME}|g" "$f"
done

echo "rewrote ${#FILES[@]} files: slug='${SLUG}' name='${NAME}'"

if [[ "$COMMIT" == "1" ]] && [[ -d .git ]]; then
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m "Bootstrap from featherless-nuxt-starter as ${SLUG}"
    echo "committed."
  else
    echo "no changes to commit (already bootstrapped?)"
  fi
fi
