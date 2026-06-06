# Build frontend
FROM node:22-bookworm-slim AS frontend
COPY .npmrc /root/.npmrc

WORKDIR /app/web

COPY sandbox-service/web/package.json sandbox-service/web/package-lock.json ./
RUN npm ci

COPY sandbox-service/web ./
RUN npm run build

# Build backend (bundle src/ to dist/ with esbuild)
FROM node:22-bookworm-slim AS backend
COPY .npmrc /root/.npmrc

WORKDIR /app/sandbox-service

# @neutree-ai/oauth-client is consumed as a file: dep; copy it before install so the
# path in package.json (file:../internal/oauth-client) resolves.
COPY internal/oauth-client /app/internal/oauth-client
COPY sandbox-service/package.json sandbox-service/package-lock.json ./
RUN npm ci

COPY sandbox-service/tsconfig.json ./
COPY sandbox-service/src ./src

RUN npm run build

# Runtime stage — minimal deps + bundled dist
FROM node:22-bookworm-slim
COPY .npmrc /root/.npmrc

WORKDIR /app/sandbox-service

COPY internal/oauth-client /app/internal/oauth-client
COPY sandbox-service/package.json sandbox-service/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=backend /app/sandbox-service/dist ./dist
COPY sandbox-service/migrations ./migrations
COPY --from=frontend /app/web/dist ./web/dist

EXPOSE 3006

CMD ["node", "dist/index.js"]
