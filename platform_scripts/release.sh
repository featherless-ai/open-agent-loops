#!/usr/bin/env bash
# release.sh — bump app.yaml's appVersion, commit, tag, push.
#
# Cuts out the manual sequence we kept repeating during the feather-agent
# migration (see DEVELOPER_UX_BUGS.md). Works from the repo root of any
# Featherless internal-app whose top-level app.yaml has an `appVersion:`
# line in dotted-decimal form.
#
# Usage:
#   platform_scripts/release.sh <patch|minor|major> [commit message]
#
# Examples:
#   platform_scripts/release.sh patch
#   platform_scripts/release.sh minor "Add /runtime-config endpoint"
#   platform_scripts/release.sh major "Rewrite tool-server in Go"
#
# What it does, in order:
#   1. Validates the bump level + that we're at a clean-enough repo root
#      (working tree may have staged or unstaged changes; they get bundled
#      into the same commit).
#   2. Parses current appVersion (X.Y.Z) and computes the next version.
#   3. Rewrites app.yaml in place with the new appVersion.
#   4. Stages every modified+untracked tracked file, commits with the
#      provided message (or a generated one).
#   5. Pushes main.
#   6. Creates an annotated tag vX.Y.Z and pushes it.
#   7. Prints the GitLab pipelines URL so the user can watch the build.
#
# Exits non-zero on any failure. Safe to re-run after fixing a problem —
# it never force-pushes and it errors if the tag already exists.

set -euo pipefail

BUMP="${1:-}"
MSG="${2:-}"

if [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "usage: $0 <patch|minor|major> [commit message]" >&2
  exit 1
fi

# Anchor to the repo root so the script is callable from anywhere.
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ ! -f app.yaml ]]; then
  echo "error: no app.yaml at $REPO_ROOT — wrong repo?" >&2
  exit 1
fi

CURRENT="$(grep -E '^appVersion:' app.yaml | sed -E 's/^appVersion:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"
if [[ ! "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "error: appVersion in app.yaml is not X.Y.Z (got: '$CURRENT')" >&2
  exit 1
fi

MAJOR="${BASH_REMATCH[1]}"
MINOR="${BASH_REMATCH[2]}"
PATCH="${BASH_REMATCH[3]}"

case "$BUMP" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEXT="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEXT}"

echo "appVersion: ${CURRENT} → ${NEXT}"

# Refuse to clobber an existing tag.
if git rev-parse "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "error: tag ${TAG} already exists — bump again or delete the old tag" >&2
  exit 1
fi

# Rewrite app.yaml. The pattern matches both quoted and unquoted forms.
# BSD/macOS sed needs an empty arg after -i; gnu sed doesn't. Detect.
if sed --version >/dev/null 2>&1; then
  sed -i -E "s/^(appVersion:[[:space:]]*\"?)${CURRENT//./\\.}(\"?)[[:space:]]*$/\1${NEXT}\2/" app.yaml
else
  sed -i '' -E "s/^(appVersion:[[:space:]]*\"?)${CURRENT//./\\.}(\"?)[[:space:]]*$/\1${NEXT}\2/" app.yaml
fi

# Sanity check the rewrite landed.
if ! grep -qE "^appVersion:[[:space:]]*\"?${NEXT//./\\.}\"?" app.yaml; then
  echo "error: failed to rewrite app.yaml (no line matched ${NEXT})" >&2
  git checkout -- app.yaml
  exit 1
fi

# Default commit message if none provided.
if [[ -z "$MSG" ]]; then
  MSG="Release ${TAG}"
fi

# Stage app.yaml plus any other changes the developer already made.
# We deliberately don't `git add -A` (avoids picking up untracked junk);
# instead, stage tracked-modified files + app.yaml. Anything untracked
# the developer wanted in needs to be `git add`'d before running this.
git add app.yaml
git add -u

# Skip commit if nothing was staged (shouldn't happen — app.yaml changed)
if git diff --cached --quiet; then
  echo "error: nothing staged after rewrite — bailing" >&2
  exit 1
fi

git commit -m "$MSG"
git push origin HEAD

# Annotated tag + push.
git tag -a "$TAG" -m "$TAG — ${MSG}"
git push origin "$TAG"

# Try to print the GitLab pipelines URL based on the remote.
REMOTE_URL="$(git config --get remote.origin.url || true)"
if [[ "$REMOTE_URL" =~ gitlab[^/]*\.[^/]+[/:]([^[:space:]]+)\.git$ ]]; then
  PROJECT_PATH="${BASH_REMATCH[1]}"
  GITLAB_HOST="$(echo "$REMOTE_URL" | sed -E 's|.*://([^/]+)/.*|\1|; s|.*@([^:]+):.*|\1|')"
  echo ""
  echo "Pushed ${TAG}. Pipeline: https://${GITLAB_HOST}/${PROJECT_PATH}/-/pipelines"
else
  echo ""
  echo "Pushed ${TAG}. (Couldn't infer pipeline URL from remote: ${REMOTE_URL})"
fi
