# Build stage — bundle src/ to dist/ with esbuild. Build context is the OSS
# repo root so any future internal/ package imports remain reachable.
FROM node:22-bookworm-slim AS builder
COPY .npmrc /root/.npmrc

WORKDIR /app/skills-content-service

COPY skills-content-service/package.json skills-content-service/package-lock.json ./
RUN npm ci

COPY skills-content-service/tsconfig.json ./
COPY skills-content-service/src ./src

RUN npm run build

# dufs binary — read-side file server. We launch one local instance pointed at
# the cache dir; Node proxies version-resolved URLs to it. Same fs API surface
# as the workspace dufs so web can share its file-browser code.
FROM sigoden/dufs:latest AS dufs

# Runtime stage — only prod deps + bundled dist + dufs.
FROM node:22-bookworm-slim
COPY .npmrc /root/.npmrc

WORKDIR /app/skills-content-service

COPY skills-content-service/package.json skills-content-service/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/skills-content-service/dist ./dist
COPY --from=dufs /bin/dufs /usr/local/bin/dufs

EXPOSE 3008
CMD ["node", "dist/index.js"]
