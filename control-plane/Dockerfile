# Build frontend
FROM node:22-bookworm-slim AS frontend-builder

# Pin npm registry mirror. .npmrc at repo root is copied into /root/.npmrc
# (npm's user-level config) so every builder stage inherits without
# per-Dockerfile ENV noise.
COPY .npmrc /root/.npmrc

WORKDIR /app/web

# Copy frontend package files (lockfile excluded — npm resolves platform-specific
# optional deps like @rollup/rollup-linux-x64-gnu fresh on each build)
COPY web/package.json ./

# Install frontend dependencies
RUN npm install

# Copy frontend source
COPY web/tsconfig.json web/vite.config.ts web/tailwind.config.js web/postcss.config.js web/index.html ./
COPY web/src ./src
COPY web/public ./public
COPY web/scripts ./scripts

# @neutree-ai/types is referenced via tsconfig path "../internal/types"
COPY internal/types /app/internal/types
# sse-consumer is referenced via vite alias 'sse-consumer' → ../internal/sse-consumer/src
COPY internal/sse-consumer /app/internal/sse-consumer
# @neutree-ai/theme is referenced via vite alias '@neutree-ai/theme' → ../internal/theme/src
# and tsconfig path "../internal/theme/index.d.ts"
COPY internal/theme /app/internal/theme

# Build-time environment for vite — these are baked into the bundle.
# Each is optional; unset means the corresponding feature degrades gracefully
# (e.g. docs link hidden).
ARG VITE_DOCS_URL=
ARG VITE_CHANNEL_GATEWAY_PUBLIC_URL=
ARG GIT_SHA=dev
ARG BUILD_TIME=
ENV VITE_DOCS_URL=$VITE_DOCS_URL
ENV VITE_CHANNEL_GATEWAY_PUBLIC_URL=$VITE_CHANNEL_GATEWAY_PUBLIC_URL
ENV VITE_APP_VERSION=$GIT_SHA
ENV VITE_BUILD_TIME=$BUILD_TIME

# @neutree-ai/types declares `zod` as a runtime dep. The web build's tsc step resolves
# zod relative to /app/internal/types/, which has no node_modules of its
# own, so install them here.
RUN cd /app/internal/types && npm install --no-audit --no-fund

# Build frontend
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

# Build backend (bundle to dist/ with esbuild)
FROM node:22-bookworm-slim AS backend-builder

COPY .npmrc /root/.npmrc

WORKDIR /app

COPY control-plane/package.json control-plane/package-lock.json ./
RUN sed -i '/"workspaces"/d' package.json
RUN npm ci

COPY control-plane/tsconfig.json ./
COPY control-plane/src ./src
COPY control-plane/scripts ./scripts
COPY control-plane/proto ./proto

# Backend imports via ../../../../internal/types/api from /app/src/routes/workspaces/*.ts,
# which resolves to /internal/types (four levels up from /app/src/routes/workspaces)
COPY internal/types /internal/types
# sse-consumer is imported via ../../../internal/sse-consumer/src from /app/src/lib/sse.ts
# and ../../../../internal/sse-consumer/src from /app/src/mcp/tools/agent.ts — both resolve
# to /internal/sse-consumer relative to the /app build context.
COPY internal/sse-consumer /internal/sse-consumer

RUN npm run build

# Runtime image — minimal deps, prebuilt dist
FROM node:22-bookworm-slim

COPY .npmrc /root/.npmrc

# ffmpeg is used by the ASR module to transcode incoming audio (webm/opus, amr, ...)
# to wav 16k mono before handing off to the configured provider.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY control-plane/package.json control-plane/package-lock.json ./
RUN sed -i '/"workspaces"/d' package.json
RUN npm ci --omit=dev

COPY --from=backend-builder /app/dist ./dist
COPY control-plane/migrations ./migrations
COPY control-plane/proto ./proto
COPY --from=frontend-builder /app/web/dist ./web/dist

# Stamp the build version into the runtime env so /api/version can serve it.
ARG GIT_SHA=dev
ARG BUILD_TIME=
ENV APP_VERSION=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

EXPOSE 3000

CMD ["node", "dist/index.js"]
