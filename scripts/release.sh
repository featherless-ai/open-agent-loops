#!/usr/bin/env bash
#
# release.sh — cut and publish a new version of the npm package.
#
# Boring and obvious by design: preflight checks → version bump → publish → push.
# The build itself is owned by `prepublishOnly` in package.json (tsup), so this
# script never builds directly — `npm publish` triggers it, and a failed build
# aborts the publish.
#
# Usage:
#   scripts/release.sh [patch|minor|major|prerelease|<exact-version>] [flags]
#
# Flags:
#   --dry-run        Build + pack and show the tarball contents; bump/publish/push are skipped.
#   --tag <name>     npm dist-tag to publish under (default: latest; use e.g. `next` for prereleases).
#   --yes            Skip the confirmation prompt.
#   --allow-branch   Permit releasing from a branch other than main.
#
# Examples:
#   scripts/release.sh patch              # 1.0.0 -> 1.0.1, publish, push tag
#   scripts/release.sh minor --dry-run    # preview only, no changes
#   scripts/release.sh prerelease --tag next
#   scripts/release.sh 2.0.0 --yes

set -euo pipefail

# --- locate repo root (works regardless of CWD) ------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# --- parse args --------------------------------------------------------------
BUMP="patch"
DIST_TAG="latest"
DRY_RUN=false
ASSUME_YES=false
ALLOW_BRANCH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    patch|minor|major|premajor|preminor|prepatch|prerelease) BUMP="$1"; shift ;;
    --dry-run)      DRY_RUN=true; shift ;;
    --yes|-y)       ASSUME_YES=true; shift ;;
    --allow-branch) ALLOW_BRANCH=true; shift ;;
    --tag)          DIST_TAG="${2:?--tag needs a value}"; shift 2 ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$1"; shift ;;   # exact version like 2.0.0
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

PKG_NAME="$(node -p "require('./package.json').name")"
PKG_VERSION="$(node -p "require('./package.json').version")"

# --- non-interactive auth (CI / ship.sh) -------------------------------------
# If an automation token is provided, authenticate via a throwaway userconfig so
# both `npm whoami` and `npm publish` read it — and an *automation* token
# bypasses the 2FA-on-publish requirement (a "Publish" token does not).
if [[ -n "${NPM_TOKEN:-}" ]]; then
  _RELEASE_NPMRC="$(mktemp)"
  printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$_RELEASE_NPMRC"
  export NPM_CONFIG_USERCONFIG="$_RELEASE_NPMRC"
  trap 'rm -f "$_RELEASE_NPMRC"' EXIT
  say "Using NPM_TOKEN for non-interactive publish"
fi

# --- preflight ---------------------------------------------------------------
say "Preflight checks for $PKG_NAME@$PKG_VERSION"

# 1. Clean working tree — never publish uncommitted state.
if [[ -n "$(git status --porcelain)" ]]; then
  fail "Working tree is dirty. Commit or stash changes before releasing."
fi

# 2. Branch guard.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" && "$ALLOW_BRANCH" != true ]]; then
  fail "On branch '$CURRENT_BRANCH', not 'main'. Pass --allow-branch to override."
fi

# 3. npm authentication + scope access.
if ! NPM_USER="$(npm whoami 2>/dev/null)"; then
  fail "Not logged in to npm. Run 'npm login' first."
fi
say "npm user: $NPM_USER"

# 4. Quality gates — typecheck + unit tests must pass.
say "Typechecking…"
bun run typecheck
say "Running tests…"
bun run test

# --- preview / confirm -------------------------------------------------------
if [[ "$DRY_RUN" == true ]]; then
  say "DRY RUN — building and packing tarball (no version bump, no publish, no push)"
  npm publish --dry-run --access public --tag "$DIST_TAG"
  say "Dry run complete. Nothing was published."
  exit 0
fi

echo
say "About to release:"
echo "    package : $PKG_NAME"
echo "    from    : $PKG_VERSION"
echo "    bump    : $BUMP"
echo "    dist-tag: $DIST_TAG"
echo "    branch  : $CURRENT_BRANCH"
echo

if [[ "$ASSUME_YES" != true ]]; then
  read -r -p "Proceed? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

# --- bump → publish → push ---------------------------------------------------
# npm version creates the commit + annotated tag locally (not pushed yet).
say "Bumping version ($BUMP)…"
NEW_VERSION="$(npm version "$BUMP" -m "release: %s")"   # e.g. "v1.0.1"
say "New version: $NEW_VERSION"

# publish triggers prepublishOnly (tsup build). If it fails, the local tag/commit
# remain but nothing was pushed — recover with the printed git command.
say "Publishing to npm…"
if ! npm publish --access public --tag "$DIST_TAG"; then
  echo >&2
  fail "Publish failed. Local commit+tag '$NEW_VERSION' exist but were NOT pushed.
       To roll back:  git tag -d $NEW_VERSION && git reset --hard HEAD~1"
fi

say "Pushing commit + tag…"
git push --follow-tags

say "Released $PKG_NAME@${NEW_VERSION#v} (dist-tag: $DIST_TAG) ✅"
