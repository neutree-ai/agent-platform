# Build stage — bundle src/ to dist/ with esbuild (inlines sse-consumer + @neutree-ai/types)
# Build context is the OSS repo root so the internal/ packages are reachable.
FROM node:22-bookworm-slim AS builder
COPY .npmrc /root/.npmrc

WORKDIR /app/scheduler

COPY scheduler/package.json scheduler/package-lock.json ./
RUN npm ci

COPY scheduler/tsconfig.json ./
COPY scheduler/src ./src

# sse-consumer (and the @neutree-ai/types it pulls in) are referenced via relative
# imports from src/. esbuild bundles them into dist/index.js, so the runtime
# stage doesn't need them.
COPY internal/sse-consumer/src /app/internal/sse-consumer/src
COPY internal/types /app/internal/types

RUN npm run build

# Runtime stage — only prod deps + bundled dist
FROM node:22-bookworm-slim
COPY .npmrc /root/.npmrc

WORKDIR /app/scheduler

COPY scheduler/package.json scheduler/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/scheduler/dist ./dist

CMD ["node", "dist/index.js"]
