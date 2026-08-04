<h1 align="center">Neutree Agent Platform</h1>

<p align="center">
  <strong>Close your laptop. Your agents keep working.</strong><br/>
  The open-source agent platform to <strong>build</strong>, <strong>distribute</strong>, and <strong>optimize</strong> AI agents, on infrastructure you own.
</p>

<p align="center">
  <a href="https://docs.neutree.ai/nap/">Docs</a> ·
  <a href="https://neutree.ai/nap">Website</a> ·
  <a href="https://docs.neutree.ai/nap/self-host/">Self-host guide</a> ·
  <a href="https://discord.gg/MnsQ73d8dq">Discord</a>
</p>

<p align="center">
  <a href="https://discord.gg/MnsQ73d8dq"><img alt="Discord" src="https://img.shields.io/badge/Discord-Neutree-5865F2?logo=discord&logoColor=white"></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <a href="CONTRIBUTING.md"><img alt="Contributions welcome" src="https://img.shields.io/badge/contributions-welcome-brightgreen.svg"></a>
</p>

---

Neutree Agent Platform (NAP) turns AI agents into a hosted, multi-user service. Instead of every developer running an agent on their own laptop, a team gets one platform to **build** agents, **distribute** them through whatever channel users already live in, and **optimize** them as they run.

## What it does

- **Build** — a neutral, swappable frontier core, shaped with prompts, skills and MCP, on top of middleware the platform runs so no agent has to ship its own. Configure it in the UI, or describe what you want and let builder mode assemble it. Change the core and the configuration comes along: it belongs to the workspace, not to the core running it.
- **Distribute** — one workspace, reachable five ways, served in whichever shape the workload needs. Nothing on the user's side: no install, no configuration, no key of their own.
- **Optimize** — the agent reads its own session history and proposes changes to its prompts and skills. Nothing lands until a human approves it.

| Area | Detail |
| --- | --- |
| **Cores** | Claude Code, Codex, Goose |
| **Middleware** | Code sandbox · Remote browser · Agent-to-agent calls · Cross-agent filesystem · Memory store · MCP connections |
| **Ways in** | Native UI · Chat channels · HTTP API · Webhook · Schedule |
| **Serving** | **Static** — fixed replicas, held whether or not anyone is asking. **Auto-scaling** — replicas follow demand and go down to zero, waking on the next turn with files and sessions intact. |
| **Human in the loop** | UI plugins place approval checkpoints inside an agent's workflow |
| **Sharing** | Prompts, skills and templates carry private / team / public scope, so a working agent is something colleagues pick up rather than retype |

Two things are honest to say up front: auto-scaling is configured through the API at workspace creation, not yet in the web UI; and building an evaluation set out of session history — to check a change, or to see whether a cheaper model holds up — is still being built. The tuning loop above ships today.

The [website](https://neutree.ai/nap) walks through all three with diagrams; the [docs](https://docs.neutree.ai/nap/) are the reference.

## Local and managed, one setup

A local agent and a managed agent are the same craft at two scales. NAP invents no new core, and no new way to shape one: the prompt, the skills and the MCP servers are the ones your local agent already uses. A setup carries over without a rewrite, your local agent can create and manage hosted ones through the API, and what you publish here can be installed back into a local agent.

## Quick start

One Linux machine, one command:

```bash
curl -sfL https://docs.neutree.ai/nap/get.sh | sudo sh -
```

It installs a single-node k3s cluster and the whole platform on it, then prints the URL and the admin credentials. 8 vCPU / 32 GB / 200 GB is enough for around ten workspaces.

To deploy into a cluster you already run, or to set anything by hand:

```bash
cd self-host
cp values.env.example values.env
./gen-secrets.sh                 # fill random machine secrets
vi values.env                    # set host, admin password, storage, …
./install.sh
```

Code Sandbox and Remote Browser are optional and can be turned on later without reinstalling. [`self-host/README.md`](self-host/README.md) is the full guide, configuration reference and optional-capability setup.

## Architecture

NAP is a set of services that share a PostgreSQL control plane. One control plane serves as many clusters as you need: workspaces run beside it, or in a remote cluster whose runner dials the control plane and keeps the line open — their network, your workspaces.

<p align="center">
  <img src="docs/architecture.svg" alt="Entry points reach the control plane, which places workspaces — each running one pluggable agent core — onto Kubernetes clusters, with platform middleware brokered to them as MCP tools and mounts" width="880">
</p>

| Component | Package | Role |
| --- | --- | --- |
| **control-plane** | `@neutree-ai/control-plane` | Core API + orchestrator: workspaces, sessions, agents, prompts, templates, skills, providers, credentials, teams. PostgreSQL-backed. |
| **web** | `@neutree-ai/web` | React front-end (Vite + Tailwind + shadcn/ui). |
| **channel-gateway** | `@neutree-ai/channel-gateway` | Bridges external channels into the platform. |
| **scheduler** | `@neutree-ai/scheduler` | Runs scheduled / recurring agent tasks. |
| **browser-service** | `@neutree-ai/browser-service` | Remote browsers agents drive, streamed to users over WebRTC. |
| **sandbox-service** | `@neutree-ai/sandbox-service` | Code sandbox control, backed by [OpenSandbox](https://github.com/alibaba/OpenSandbox). |
| **skills-content-service** | `@neutree-ai/skills-content-service` | Serves agent skill content. |
| **env-runner-k8s** | `@neutree-ai/env-runner-k8s` | Places and supervises workspace containers on Kubernetes. |
| **memory-fuse** | — | FUSE layer exposing agent memory as a filesystem. |
| **agents/** | — | Agent runtime adapters (`claude-code`, `codex`, `goose`). |
| **internal/** | `@neutree-ai/*` | Shared libraries — client, types, ACP adapter, agent skills, OAuth, theme, platform prompt, and the published [`ui-sdk`](internal/ui-sdk). |
| **packages/sandbox** | `@neutree-ai/sandbox` | Published SDK for driving sandboxes from your own code. |
| **docs-site** | `@neutree-ai/docs-site` | The documentation at [docs.neutree.ai/nap](https://docs.neutree.ai/nap/) (Astro + Starlight, en / zh-CN). |

### Where to start reading

- `control-plane/src/routes` — the API surface, and the quickest map of what the platform can do
- `control-plane/src/services` — orchestration and the PostgreSQL layer under it
- `agents/<core>/src` — how one frontier core is adapted; the three are worth diffing against each other
- `web/src` — the shell users actually operate
- `self-host/` — how the whole thing is deployed, including the air-gapped path

## Container images

First-party images are published to GitHub Container Registry under `ghcr.io/neutree-ai/agent-platform/` (e.g. `nap-cp`, `nap-cg`, `nap-scheduler`, `nap-browser`, `nap-sandbox`). Builds are driven by [`.github/workflows/build-images.yml`](.github/workflows/build-images.yml): images are built on demand (`workflow_dispatch`) or when a per-service release tag `<image>-v<x.y.z>` is pushed — services version independently.

## Community

[**Discord**](https://discord.gg/MnsQ73d8dq) is where the projects live day to day — questions,
support, and the people who work on them. It covers everything Neutree builds, not just this
repository, so tag your `#help` post with the product it's about.

Bugs and feature requests belong in [Issues](https://github.com/neutree-ai/agent-platform/issues),
where they don't scroll away. Design proposals that need to outlive a conversation go in
[Discussions](https://github.com/orgs/neutree-ai/discussions).

Most install problems are answered in one round when the question says **which install path**
(connected or air-gapped), quotes **the error verbatim**, and says **what you already tried**.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, branch/PR conventions, and local-dev setup, and note our [Code of Conduct](CODE_OF_CONDUCT.md). For security issues, see [SECURITY.md](SECURITY.md) — please do not open public issues for vulnerabilities.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Arcfra.
