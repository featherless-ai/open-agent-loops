#!/usr/bin/env bash
#
# ship.sh — release BOTH in one command: publish the npm package, then deploy
# the docs.
#   1) scripts/release.sh <bump>  → typecheck/tests → version bump → npm publish → push tag
#   2) scripts/deploy-docs.sh     → build → Cloudflare deploy (refreshes the live docs)
#
# Credentials live in scripts/.deploy.env (GITIGNORED — see scripts/.deploy.env.example):
#   NPM_TOKEN=npm_...                       # npm AUTOMATION token (bypasses 2FA)
#   DOCS_DEPLOY_ENV=/abs/path/.deploy.env   # file defining CLOUDFLARE_API_TOKEN +
#                                           #   CLOUDFLARE_ACCOUNT_ID (Recursal PROD)
# …or export those vars in your shell directly. Anything already in the env wins.
#
# Usage:
#   scripts/ship.sh [patch|minor|major] [--yes]   # default bump: patch
#   scripts/ship.sh --npm-only                     # publish package, skip docs
#   scripts/ship.sh --docs-only                    # deploy docs, skip publish

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

BUMP="patch"
ASSUME_YES=false
DO_NPM=true
DO_DOCS=true
for a in "$@"; do
  case "$a" in
    patch|minor|major|premajor|preminor|prepatch|prerelease) BUMP="$a" ;;
    --yes|-y)     ASSUME_YES=true ;;
    --npm-only)   DO_DOCS=false ;;
    --docs-only)  DO_NPM=false ;;
    *) echo "Unknown argument: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;35m■ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Load shared, gitignored creds (NPM_TOKEN, DOCS_DEPLOY_ENV / CLOUDFLARE_*).
if [[ -f "$SCRIPT_DIR/.deploy.env" ]]; then
  set -a; . "$SCRIPT_DIR/.deploy.env"; set +a
fi

# Single confirmation for the whole operation; sub-scripts then run unattended.
if [[ "$ASSUME_YES" != true ]]; then
  echo
  say "About to SHIP:"
  [[ "$DO_NPM"  == true ]] && echo "    • npm publish  (version bump: $BUMP)"
  [[ "$DO_DOCS" == true ]] && echo "    • docs deploy  → https://openagentloops.featherless.ai (production)"
  echo
  read -r -p "Proceed? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

if [[ "$DO_NPM" == true ]]; then
  say "1/2 — publishing npm package ($BUMP)"
  bash "$SCRIPT_DIR/release.sh" "$BUMP" --yes \
    || fail "npm publish failed — docs NOT deployed. Fix and re-run (use --docs-only to skip the already-published bump)."
fi

if [[ "$DO_DOCS" == true ]]; then
  say "2/2 — deploying docs to Cloudflare"
  bash "$SCRIPT_DIR/deploy-docs.sh" --yes
fi

say "Shipped ✅  (npm: $DO_NPM · docs: $DO_DOCS)"
