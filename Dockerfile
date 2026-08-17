# Cloud image for the AI Solopreneur agent.
#
# Nobody needs Docker installed to use this. The hosting platform reads this
# file and builds the image on its own servers. Learners run the agent on their
# own computer with `npm start`, which does not involve Docker at all and is
# not affected by anything in here.

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
# Pinned to the same Node release as .node-version so the cloud runs exactly
# what the classroom runs.
FROM node:24.18.0-bookworm-slim AS builder

# sqlite3 and isolated-vm are the two dependencies that compile from C++
# source (they are the `true` entries in the root package.json allowScripts
# block). Without these three packages the install fails partway through with
# a compiler error, which is the single least recoverable thing a learner can
# be shown.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# npm_config_jobs / JOBS: node-gyp compiles with one job per CPU by default, and
# isolated-vm builds V8 isolates — several parallel C++ compilers each holding a
# lot of memory. On a small build machine that peak is what kills the build, and
# it does it in the least helpful way available: the builder is killed, so the
# log dies with it and fourteen minutes of output is replaced by nothing at all.
# One job is slower and finishes.
ENV npm_config_cache=/tmp/npm-cache \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_jobs=1 \
    JOBS=1

# n8n is ~1.5 GB installed and changes only when package-lock.json changes.
# It is copied and installed on its own so that every later edit to a skill,
# a workflow or the chat app reuses the cached layer instead of reinstalling.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY services/document-worker/package.json services/document-worker/package-lock.json ./services/document-worker/
RUN npm ci --prefix services/document-worker --omit=dev

# The chat app needs TypeScript to build, so dev dependencies go in here and
# come back out after the build.
COPY apps/chat/package.json apps/chat/package-lock.json ./apps/chat/
RUN npm ci --prefix apps/chat

COPY . .

RUN npm run build --prefix apps/chat \
 && npm prune --omit=dev --prefix apps/chat

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM node:24.18.0-bookworm-slim AS runtime

# tini reaps orphaned processes and passes SIGTERM through cleanly, so a
# redeploy shuts n8n down properly instead of killing it mid-write.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app /app

# Defaults only. scripts/cloud.mjs reads the platform's own variables first,
# so none of these need to be set by hand in a hosting dashboard.
ENV NODE_ENV=production \
    AGENT_DATA_DIR=/data \
    CHAT_PORT=3000 \
    N8N_PORT=5678 \
    DOCUMENT_WORKER_PORT=3100

# 3000 is the agent's chat interface and the port the health check uses.
# 5678 is the n8n workshop, and the port every trigger address points at.
# Give each one its own domain in the hosting dashboard.
EXPOSE 3000 5678

# Runs as root so that a volume mounted by the platform is always writable.
# Dropping privileges needs the mount chowned first, which is a hardening step
# worth taking once the deployment path itself is proven.

ENTRYPOINT ["/usr/bin/tini", "--"]
# The supervisor only spawns children and forwards their logs, so its heap is
# capped. Left at Node's default it settles around 76 MB, which is memory the
# learner pays for every hour and never uses.
CMD ["node", "--max-old-space-size=128", "scripts/cloud.mjs"]
