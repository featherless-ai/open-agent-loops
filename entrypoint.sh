#!/usr/bin/env sh
set -eu

# Port precedence: platform-declared SANDBOX_SERVICE_PORT > local PORT > 3000.
PORT="${SANDBOX_SERVICE_PORT:-${PORT:-3000}}"
export NITRO_PORT="$PORT"
export HOST="0.0.0.0"

echo "starting featherless-nuxt-starter on :$PORT"
exec bun run .output/server/index.mjs
