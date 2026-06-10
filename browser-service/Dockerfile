# Build frontend
FROM node:22-bookworm-slim AS frontend
COPY .npmrc /root/.npmrc

WORKDIR /app/web

COPY browser-service/web/package.json ./
RUN npm install

COPY browser-service/web/tsconfig.json browser-service/web/vite.config.ts browser-service/web/tailwind.config.js browser-service/web/postcss.config.js browser-service/web/index.html ./
COPY browser-service/web/public ./public
COPY browser-service/web/src ./src

RUN npm run build

# Build backend (bundle src/ to dist/ with esbuild)
FROM node:22-bookworm-slim AS backend
COPY .npmrc /root/.npmrc

WORKDIR /app/browser-service

COPY internal/oauth-client /app/internal/oauth-client
COPY browser-service/package.json browser-service/package-lock.json ./
RUN npm ci

COPY browser-service/tsconfig.json ./
COPY browser-service/src ./src

RUN npm run build

# Runtime stage — minimal deps + bundled dist
FROM node:22-bookworm-slim
COPY .npmrc /root/.npmrc

WORKDIR /app/browser-service

COPY internal/oauth-client /app/internal/oauth-client
COPY browser-service/package.json browser-service/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=backend /app/browser-service/dist ./dist
COPY browser-service/migrations ./migrations
COPY --from=frontend /app/web/dist ./web/dist

EXPOSE 3005

CMD ["node", "dist/index.js"]
