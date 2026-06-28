# Build stage — bundle src/ to dist/ with esbuild (inlines internal/k8s-provider
# + internal/types via relative imports). Build context is the OSS repo root so
# the internal/ packages are reachable.
FROM node:22-bookworm-slim AS builder
COPY .npmrc /root/.npmrc

WORKDIR /app/env-runner-k8s

COPY env-runner-k8s/package.json env-runner-k8s/package-lock.json ./
RUN npm ci

COPY env-runner-k8s/tsconfig.json ./
COPY env-runner-k8s/src ./src

# internal/{env-runner-core,k8s-provider,env-tunnel} (and the internal/types
# they pull in) are referenced via relative imports from src/. esbuild bundles
# them into dist/index.js, so the runtime stage doesn't need them.
# @kubernetes/client-node and multiplex stay external.
COPY internal/env-runner-core /app/internal/env-runner-core
COPY internal/k8s-provider/package.json internal/k8s-provider/index.ts /app/internal/k8s-provider/
COPY internal/env-tunnel /app/internal/env-tunnel
COPY internal/types /app/internal/types

RUN npm run build

# Runtime stage — only prod deps + bundled dist
FROM node:22-bookworm-slim
COPY .npmrc /root/.npmrc

WORKDIR /app/env-runner-k8s

COPY env-runner-k8s/package.json env-runner-k8s/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/env-runner-k8s/dist ./dist

CMD ["node", "dist/index.js"]
