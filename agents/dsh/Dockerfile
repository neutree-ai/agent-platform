# === Build stage ===
# node 22.19+ / 24+: the dsh packages declare it and their bins refuse older.
# The full image, not -slim: node-pty (via dsh-subprocess-local, which owns the
# bash executor's process groups) is the tree's one native module, and the full
# image already carries the toolchain it needs. The runtime stage then copies
# the built node_modules instead of compiling again, so no compiler is ever
# installed into — or purged from — the shipped image.
FROM node:22 AS builder

# Pin npm registry mirror — see repo-root .npmrc
COPY .npmrc /root/.npmrc

WORKDIR /build

# Copy shared packages (compile-time only)
COPY internal/types/ ./internal/types/
COPY internal/acp-adapter/ ./internal/acp-adapter/
COPY internal/dsh-adapter/ ./internal/dsh-adapter/
COPY internal/agent-skills/ ./internal/agent-skills/
COPY internal/platform-prompt/ ./internal/platform-prompt/
COPY internal/agent-usage/ ./internal/agent-usage/
COPY internal/mcp-forward/ ./internal/mcp-forward/

WORKDIR /build/internal/types
RUN npm install --no-audit --no-fund

WORKDIR /build/internal/agent-skills
RUN npm install --no-audit --no-fund

WORKDIR /build/internal/acp-adapter
RUN npm install --no-audit --no-fund

WORKDIR /build/internal/dsh-adapter
RUN npm install --no-audit --no-fund

WORKDIR /build/internal/platform-prompt
RUN npm install

# Install agent dependencies
COPY agents/dsh/package.json agents/dsh/package-lock.json* /build/agents/dsh/
WORKDIR /build/agents/dsh
RUN npm install

# Copy agent source and build
COPY agents/dsh/src/ ./src/
COPY agents/dsh/tsconfig.json ./
RUN npm run build \
    && cp /build/internal/platform-prompt/prompt.md dist/internal/platform-prompt/ \
    && cp -r /build/internal/agent-skills/platform dist/internal/agent-skills/ \
    && npm prune --omit=dev \
    && npm cache clean --force

# === Runtime stage ===
FROM sigoden/dufs:latest AS dufs
FROM tsl0922/ttyd:latest AS ttyd
FROM node:22-slim

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
# releases.astral.sh from some networks (CN).
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

WORKDIR /app

# The dsh runtime is npm packages, not a standalone binary: the JSON-RPC bin
# plus every plugin the generated composition names. They arrive pre-built from
# the builder — same Debian release, so the native binding is compatible.
COPY agents/dsh/package.json agents/dsh/package-lock.json* ./
COPY --from=builder /build/agents/dsh/node_modules ./node_modules
# The binding is the one thing a copied tree can get wrong; fail the build here
# rather than in a workspace whose bash tool then has no process groups.
RUN node -e "import('node-pty').then(() => console.log('node-pty ok'), (e) => { console.error(e); process.exit(1) })"

# Copy full build output (preserves relative import paths between agent and shared packages)
COPY --from=builder /build/agents/dsh/dist/agents/ ./dist/agents/
COPY --from=builder /build/agents/dsh/dist/internal/ ./dist/internal/

# The patched SDK server, published under the bare name the generated
# composition loads. It lives outside node_modules and is linked in, so its own
# `@deepseek-ai/*` imports resolve against /app/node_modules like any other
# plugin's would.
RUN mkdir -p /app/dsh-plugin \
    && printf '{"name":"dsh-resume-server","version":"0.0.0","type":"module","main":"index.js"}\n' > /app/dsh-plugin/package.json \
    && cp /app/dist/agents/dsh/src/runtime/resume-server.js /app/dsh-plugin/index.js \
    && ln -s /app/dsh-plugin /app/node_modules/dsh-resume-server

# Generated per-session compositions carry MCP credentials; keep them off the
# workspace volume and readable only by the agent.
RUN mkdir -p /app/sessions && chown -R node:node /app/sessions /app/dsh-plugin

COPY --from=dufs /bin/dufs /usr/local/bin/dufs
COPY --from=ttyd /usr/bin/ttyd /usr/local/bin/ttyd
COPY agents/tmux.conf /etc/tmux.conf
COPY agents/vimrc /etc/vim/vimrc

RUN mkdir -p /workspace/.home && chown -R node:node /workspace \
    && usermod -d /workspace/.home node

ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TERM=xterm-256color WORKSPACE_DIR=/workspace HOME=/workspace/.home PATH=/workspace/.home/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DSH_APP_DIR=/app

USER node

RUN git config --global user.name "NAP Agent" \
    && git config --global user.email "agent@tos.local"

EXPOSE 3001

WORKDIR /workspace

CMD ["node", "/app/dist/agents/dsh/src/index.js"]
