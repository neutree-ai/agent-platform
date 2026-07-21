# === Build stage ===
FROM node:20-slim AS builder

# Pin npm registry mirror — see repo-root .npmrc
COPY .npmrc /root/.npmrc

WORKDIR /build

# Copy shared packages (compile-time only)
COPY internal/types/ ./internal/types/
COPY internal/acp-adapter/ ./internal/acp-adapter/
COPY internal/agent-skills/ ./internal/agent-skills/
COPY internal/platform-prompt/ ./internal/platform-prompt/
COPY internal/agent-usage/ ./internal/agent-usage/

# Install shared package dependencies (needed for tsc to resolve imports).
# @neutree-ai/types declares zod and is imported by the agent's tsc via paths; without
# its own node_modules, zod resolution fails inside the type module.
WORKDIR /build/internal/types
RUN npm install --no-audit --no-fund

WORKDIR /build/internal/agent-skills
RUN npm install --no-audit --no-fund

WORKDIR /build/internal/acp-adapter
RUN npm install --no-audit --no-fund

WORKDIR /build/internal/platform-prompt
RUN npm install

# Install agent dependencies
COPY agents/goose/package.json agents/goose/package-lock.json* /build/agents/goose/
WORKDIR /build/agents/goose
RUN npm install

# Copy agent source and build
COPY agents/goose/src/ ./src/
COPY agents/goose/tsconfig.json ./
RUN npm run build \
    && cp /build/internal/platform-prompt/prompt.md dist/internal/platform-prompt/ \
    && cp -r /build/internal/agent-skills/platform dist/internal/agent-skills/

# === Runtime stage ===
FROM sigoden/dufs:latest AS dufs
FROM tsl0922/ttyd:latest AS ttyd
FROM node:20-slim

# Re-declare BuildKit's multi-platform auto-arg without a default — BuildKit
# only injects the target arch when the ARG has no default value.
ARG TARGETARCH

COPY .npmrc /root/.npmrc

# System packages — slowest layer, changes least
RUN apt-get update && apt-get install -y --no-install-recommends -o Acquire::Retries=3 \
    git bash curl ca-certificates python3 python-is-python3 python3-requests python3-yaml ripgrep jq less unzip bzip2 openssh-client poppler-utils \
    tmux sudo locales vim-tiny sshpass \
    && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen \
    && locale-gen \
    && echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && rm -rf /var/lib/apt/lists/*

# gogcli (pinned)
RUN curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_${TARGETARCH}.tar.gz \
    | tar xz -C /usr/local/bin gog

# gh CLI (latest) — resolve the version from the releases-page redirect
# instead of api.github.com, whose anonymous rate limit 403s on shared IPs.
RUN GH_VER=$(curl -fsSLI --retry 3 --retry-delay 2 --retry-all-errors -o /dev/null -w '%{url_effective}' https://github.com/cli/cli/releases/latest | sed 's|.*/tag/v||') \
    && curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors https://github.com/cli/cli/releases/latest/download/gh_${GH_VER}_linux_${TARGETARCH}.tar.gz \
    | tar xz --strip-components=1 -C /usr/local

# uv (latest) — direct GitHub release; astral.sh install.sh hangs on
# releases.astral.sh from some networks (CN), and `curl | sh` silently masks
# the failure, leaving the image without uv.
RUN case "$TARGETARCH" in amd64) UV_ARCH=x86_64 ;; arm64) UV_ARCH=aarch64 ;; \
        *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; esac \
    && curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors https://github.com/astral-sh/uv/releases/latest/download/uv-${UV_ARCH}-unknown-linux-gnu.tar.gz \
    | tar xz --strip-components=1 -C /usr/local/bin \
        uv-${UV_ARCH}-unknown-linux-gnu/uv uv-${UV_ARCH}-unknown-linux-gnu/uvx

# agent-browser (tarball ships every arch; pick by TARGETARCH)
RUN case "$TARGETARCH" in amd64) AB_ARCH=x64 ;; arm64) AB_ARCH=arm64 ;; \
        *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; esac \
    && npm pack agent-browser --pack-destination /tmp \
    && tar xzf /tmp/agent-browser-*.tgz -C /tmp \
    && cp /tmp/package/bin/agent-browser-linux-${AB_ARCH} /usr/local/bin/agent-browser \
    && chmod +x /usr/local/bin/agent-browser \
    && rm -rf /tmp/agent-browser-* /tmp/package

# Goose CLI (pinned) — Rust static binary, spoken to over ACP (`goose acp`)
# by the bridge (BRIDGE_OPTS in src/index.ts). Single binary: no npm package,
# no runtime dep. Release assets live on the block/goose repo (redirects to
# the AAIF org after the Linux Foundation donation).
RUN case "$TARGETARCH" in amd64) GOOSE_ARCH=x86_64 ;; arm64) GOOSE_ARCH=aarch64 ;; \
        *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; esac \
    && curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors https://github.com/block/goose/releases/download/v1.43.0/goose-${GOOSE_ARCH}-unknown-linux-gnu.tar.bz2 \
    | tar xj -C /usr/local/bin ./goose \
    && chmod +x /usr/local/bin/goose \
    && /usr/local/bin/goose --version

WORKDIR /app

# Install production dependencies only
COPY agents/goose/package.json agents/goose/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copy full build output (preserves relative import paths between agent and shared packages)
# Must copy entire dist/ tree so relative imports to shared packages resolve correctly
COPY --from=builder /build/agents/goose/dist/agents/ ./dist/agents/
COPY --from=builder /build/agents/goose/dist/internal/ ./dist/internal/

# Copy dufs binary for file browser
COPY --from=dufs /bin/dufs /usr/local/bin/dufs

# Copy ttyd binary for web terminal
COPY --from=ttyd /usr/bin/ttyd /usr/local/bin/ttyd

# Shared tmux config (enables mouse scrolling in web terminal)
COPY agents/tmux.conf /etc/tmux.conf

# System vimrc — vim-tiny launched as `vi` runs vi-compatible by default,
# which breaks arrow keys in insert mode (inserts A/B/C/D). nocompatible fixes it.
COPY agents/vimrc /etc/vim/vimrc

# Create workspace directory
RUN mkdir -p /workspace/.home && chown -R node:node /workspace \
    && usermod -d /workspace/.home node

# GOOSE_DISABLE_KEYRING: no system keyring in the container — secrets ride env.
# Also set by applyProviderEnv; the ENV covers interactive terminal use.
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TERM=xterm-256color WORKSPACE_DIR=/workspace HOME=/workspace/.home PATH=/workspace/.home/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin GOOSE_DISABLE_KEYRING=1

USER node

RUN git config --global user.name "NAP Agent" \
    && git config --global user.email "agent@tos.local"

EXPOSE 3001

WORKDIR /workspace

CMD ["node", "/app/dist/agents/goose/src/index.js"]
