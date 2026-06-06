# Build stage — bundle src/ to dist/ with esbuild (inlines @neutree-ai/client and @neutree-ai/types)
FROM node:22-bookworm-slim AS builder
COPY .npmrc /root/.npmrc

WORKDIR /app/channel-gateway

COPY channel-gateway/package.json channel-gateway/package-lock.json ./
RUN npm ci

COPY channel-gateway/tsconfig.json ./
COPY channel-gateway/src ./src

# @neutree-ai/client and @neutree-ai/types are referenced via relative imports from src/.
# They get bundled into dist/index.js, so the runtime stage doesn't need them.
COPY internal/client/src /app/internal/client/src
COPY internal/types /app/internal/types

RUN npm run build

# Runtime stage
FROM node:22-bookworm-slim
COPY .npmrc /root/.npmrc

WORKDIR /app/channel-gateway

COPY channel-gateway/package.json channel-gateway/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/channel-gateway/dist ./dist
COPY channel-gateway/migrations ./migrations

EXPOSE 3002

CMD ["node", "dist/index.js"]
