#!/usr/bin/env bash
#
# deploy-docs.sh — build the Fumadocs site and publish it to Cloudflare Workers
# (static assets) at https://openagentloops.featherless.ai.
#
# The docs deploy is MANUAL: merging changes to `main` does not refresh the live
# site — this script is what pushes it to the edge. `prebuild` regenerates the
# TypeDoc API reference + example snippets first, so the deployed docs always
# match the source (e.g. the published package name).
#
# Auth: `wrangler login` (OAuth) or CLOUDFLARE_API_TOKEN in the env. If the
# Cloudflare login has MORE THAN ONE account (e.g. a personal + an org account),
# wrangler can't guess which to deploy to — set CLOUDFLARE_ACCOUNT_ID to the one
# that owns the `open-agent-loops-docs` worker, e.g.:
#   CLOUDFLARE_ACCOUNT_ID=xxxx scripts/deploy-docs.sh
#
# Usage:
#   scripts/deploy-docs.sh            # build + deploy to production
#   scripts/deploy-docs.sh --dry-run  # build + `wrangler deploy --dry-run` (no upload)
#   scripts/deploy-docs.sh --yes      # skip the confirmation prompt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$ROOT_DIR/docs-fuma"
SITE_URL="https://openagentloops.featherless.ai"
WORKER="open-agent-loops-docs"

DRY_RUN=false
ASSUME_YES=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --yes|-y)  ASSUME_YES=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }

# --- credentials -------------------------------------------------------------
# The featherless.ai zone (needed to bind the custom domain) lives in the
# Recursal PROD account; its scoped token + account id live in a gitignored
# deploy-env file OUTSIDE this repo. If no Cloudflare token is already in the
# env, source that file (override its path with DOCS_DEPLOY_ENV).
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  DOCS_DEPLOY_ENV="${DOCS_DEPLOY_ENV:-$ROOT_DIR/../guarded-api-cloudflare/worker/.deploy.env}"
  if [[ -f "$DOCS_DEPLOY_ENV" ]]; then
    say "Sourcing Cloudflare creds from $DOCS_DEPLOY_ENV"
    set -a; . "$DOCS_DEPLOY_ENV"; set +a
  fi
fi

cd "$DOCS_DIR"

# --- confirm (production push) ----------------------------------------------
if [[ "$ASSUME_YES" != true && "$DRY_RUN" != true ]]; then
  echo
  say "About to deploy docs to PRODUCTION: $SITE_URL (worker: $WORKER)"
  read -r -p "Proceed? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

# --- build -------------------------------------------------------------------
# Custom domain serves from root, so basePath must be empty — unset it in case a
# prior GitHub Pages build left it in the env. NEXT_PUBLIC_SITE_URL feeds the
# OG-image metadataBase. `bun run build` runs prebuild (API reference + snippets)
# then `next build`, emitting ./out.
say "Building static site…"
unset NEXT_PUBLIC_BASE_PATH
NEXT_PUBLIC_SITE_URL="$SITE_URL" bun run build

# --- deploy ------------------------------------------------------------------
# wrangler surfaces its own auth/account errors clearly (incl. "more than one
# account — set CLOUDFLARE_ACCOUNT_ID"); no fragile precheck here.
if [[ "$DRY_RUN" == true ]]; then
  say "Dry run — wrangler deploy --dry-run (no upload)"
  bunx wrangler@3 deploy --dry-run
  say "Dry run complete. Nothing was deployed."
  exit 0
fi

say "Deploying to Cloudflare…"
bunx wrangler@3 deploy

say "Docs deployed → $SITE_URL ✅"
