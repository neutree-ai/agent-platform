<h1 align="center">Neutree Agent Platform</h1>

<p align="center">
  Turn your expertise into agents — available anytime, anywhere, to anyone.<br/>
  An open platform to <strong>build</strong>, <strong>distribute</strong>, and <strong>optimize</strong> AI agents, on infrastructure your team can host.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <a href="CONTRIBUTING.md"><img alt="Contributions welcome" src="https://img.shields.io/badge/contributions-welcome-brightgreen.svg"></a>
</p>

---

Neutree Agent Platform (NAP) turns AI agents into a hosted, multi-user service. Instead of every developer running an agent on their own laptop, a team gets one platform to **build** agents, **distribute** them through whatever channel users already live in, and **optimize** them as they run.

## Build — more with less, on the platform

- **Agent core** — a neutral, swappable frontier agent at the center. Claude Code and Codex are supported today, and the runtime extends to others. Shape its expertise with prompts, skills, and MCP.
- **Agent middleware, batteries included** — sandbox, remote browser, agent-native shared filesystem, memory store, multi-agent orchestration, and MCP gateway are provided by the platform. Agents use them out of the box instead of each rebuilding them.
- **Build it your way** — configure agents directly through the UI, or describe the expertise you want in natural language and let an agent assemble it for you.
- **Custom human-in-the-loop UIs** — build UI plugins that place the right human checkpoints into an agent's workflow, so people can approve and steer at exactly the right moments.
- **Resource library** — agent templates, prompts, and skills become shared, reusable assets, so a team standardizes and forks instead of starting over.

## Distribute — build once, use everywhere

- **Access entry points** — drive an agent from the built-in web UI, from message channels like Slack/IM through the channel gateway, or embed it in your own web app with the HTTP API and UI SDK.
- **Run modes** — run agents **resident** (always-on, zero cold start, for latency-sensitive workloads) or **serverless** (scale from zero, start on demand, pay for what you use).

## Optimize — agents that improve with use

- **Autonomous tuning** — mine session history for where an agent underperforms and continuously refine its prompts and skills, so it gets cheaper and better the more it runs.
- **Model swapping** *(planned)* — automatically evaluate against cheaper models and switch when quality holds, to keep pushing cost down.

## Architecture

NAP is a set of services that share a PostgreSQL control plane.

| Component | Package | Role |
| --- | --- | --- |
| **control-plane** | `@neutree-ai/control-plane` | Core API + orchestrator: workspaces, sessions, agents, prompts, templates, skills, providers, credentials, teams. PostgreSQL-backed. |
| **web** | `@neutree-ai/web` | React front-end (Vite + Tailwind + shadcn/ui). |
| **channel-gateway** | `@neutree-ai/channel-gateway` | Bridges external channels into the platform. |
| **scheduler** | `@neutree-ai/scheduler` | Runs scheduled / recurring agent tasks. |
| **browser-service** | `@neutree-ai/browser-service` | Remote browser agents drive, streamed to users over WebRTC. |
| **sandbox-service** | `@neutree-ai/sandbox-service` | Code sandbox control, backed by [OpenSandbox](https://github.com/alibaba/OpenSandbox). |
| **skills-content-service** | `@neutree-ai/skills-content-service` | Serves agent skill content. |
| **memory-fuse** | — | FUSE layer exposing agent memory as a filesystem. |
| **agents/** | — | Agent runtime adapters (`claude-code`, `codex`). |
| **internal/** | `@neutree-ai/*` | Shared libraries (client, types, oauth-client, theme, prompt, …). |

## Quick start

The fastest way to stand up the whole platform is the self-host installer, which deploys to a Kubernetes cluster (multi-node or a single k3s node):

```bash
cd self-host
cp values.env.example values.env
./gen-secrets.sh                 # fill random machine secrets
vi values.env                    # set host, admin password, storage, …
./install.sh
```

When it finishes, open the web UI and log in with the admin credentials from `values.env`. The Code Sandbox and Remote Browser capabilities are optional and can be enabled later without reinstalling — see [`self-host/README.md`](self-host/README.md) for the full guide, configuration reference, and optional-capability setup.

## Container images

First-party images are published to GitHub Container Registry under `ghcr.io/neutree-ai/agent-platform/` (e.g. `nap-cp`, `nap-cg`, `nap-scheduler`, `nap-browser`, `nap-sandbox`). Builds are driven by [`.github/workflows/build-images.yml`](.github/workflows/build-images.yml): images are built on demand (`workflow_dispatch`) or when a per-service release tag `<image>-v<x.y.z>` is pushed — services version independently.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, branch/PR conventions, and local-dev setup, and note our [Code of Conduct](CODE_OF_CONDUCT.md). For security issues, see [SECURITY.md](SECURITY.md) — please do not open public issues for vulnerabilities.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Arcfra.
