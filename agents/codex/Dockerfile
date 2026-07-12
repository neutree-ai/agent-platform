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
COPY agents/codex/package.json agents/codex/package-lock.json* /build/agents/codex/
WORKDIR /build/agents/codex
RUN npm install

# Copy agent source and build
COPY agents/codex/src/ ./src/
COPY agents/codex/tsconfig.json ./
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
    git bash curl ca-certificates python3 python-is-python3 python3-requests python3-yaml ripgrep jq less unzip openssh-client poppler-utils \
    tmux sudo locales vim-tiny sshpass \
    && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen \
    && locale-gen \
    && echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && rm -rf /var/lib/apt/lists/*

# gogcli (pinned)
RUN curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_${TARGETARCH}.tar.gz \
    | tar xz -C /usr/local/bin gog

# gh CLI (latest)
RUN GH_VER=$(curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors https://api.github.com/repos/cli/cli/releases/latest | jq -r '.tag_name|ltrimstr("v")') \
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

# Install codex-acp globally (pre-install to avoid npx cold start).
# Upstream rewrite: github.com/agentclientprotocol/codex-acp — a TypeScript ACP
# server that drives codex over its app-server JSON-RPC protocol (codex 0.144+)
# and bundles the codex binary through @openai/codex (per-arch native dep, npm
# resolves the host arch — no TARGETARCH switch needed, no glibc constraint).
# Replaces the previous Rust-based codex-acp fork: its collab-subagent and
# image-generation event patches are subsumed by codex 0.142's first-class
# ItemStarted/ItemCompleted lifecycle (collabAgentToolCall / imageGeneration
# items), so they no longer need to be carried here. bin name `codex-acp`
# and no-arg stdio-server invocation match the bridge's BRIDGE_OPTS.
RUN npm install -g --registry=https://registry.npmjs.org @agentclientprotocol/codex-acp@1.1.2

WORKDIR /app

# Install production dependencies only
COPY agents/codex/package.json agents/codex/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copy full build output (preserves relative import paths between agent and shared packages)
# Must copy entire dist/ tree so relative imports to shared packages resolve correctly
COPY --from=builder /build/agents/codex/dist/agents/ ./dist/agents/
COPY --from=builder /build/agents/codex/dist/internal/ ./dist/internal/

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

ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TERM=xterm-256color WORKSPACE_DIR=/workspace HOME=/workspace/.home PATH=/workspace/.home/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

USER node

RUN git config --global user.name "NAP Agent" \
    && git config --global user.email "agent@tos.local"

EXPOSE 3001

WORKDIR /workspace

CMD ["node", "/app/dist/agents/codex/src/index.js"]
