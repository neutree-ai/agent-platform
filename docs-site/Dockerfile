FROM node:22-alpine AS build
COPY .npmrc /root/.npmrc
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Where the image will be served. Defaults match the upstream site; a
# distribution serving the docs elsewhere passes its own, e.g.
# --build-arg DOCS_BASE=/ --build-arg DOCS_SITE=https://docs.example.com
ARG DOCS_SITE
ARG DOCS_BASE
ENV DOCS_SITE=$DOCS_SITE DOCS_BASE=$DOCS_BASE
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
