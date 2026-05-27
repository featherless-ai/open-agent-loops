# syntax=docker/dockerfile:1.4
FROM featherlessai/sandbox-base-image:latest

# Bun runtime.
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -sf /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /app

# Deps first for layer caching.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Source.
COPY . .

# Ensure entrypoint.sh is executable. The file IS executable in git (mode
# 100755) and in a fresh `git clone`, but sandbox-svc's commitMulti REST
# call drops the mode when pushing the rewritten starter into a new
# GitLab project — so by the time Docker COPYs it during the build, the
# executable bit is gone and Daytona's ENTRYPOINT fails with "permission
# denied: /app/entrypoint.sh". Defensive chmod here covers either path.
RUN chmod +x /app/entrypoint.sh

# Build Nuxt for production. Outputs to .output/server/index.mjs.
RUN bun run build

# Featherless sandbox exposes the service via $SANDBOX_SERVICE_PORT (3000).
EXPOSE 3000

# ENTRYPOINT (not CMD): Daytona reads the image's ENTRYPOINT field and spawns
# it as the sandbox's entrypoint session. CMD alone leaves Daytona with
# nothing to launch and the preview URL returns 502.
ENTRYPOINT ["/app/entrypoint.sh"]
