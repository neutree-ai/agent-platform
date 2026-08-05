---
title: Agent Skills
description: The nap-api skill — what teaches a local agent to drive NAP through its own API
---

A local agent and a hosted one are the same craft at two scales, and the API is the seam between them: your local agent can create hosted agents, hand them work, and read back what they did. It just has to know the API.

That's what `nap-api` is for. It ships in the repository under [`skills/`](https://github.com/neutree-ai/agent-platform/tree/main/skills) and is an ordinary [Agent Skill](https://docs.claude.com/en/docs/agent-skills) — a directory with a `SKILL.md` the agent reads at startup.

## What's in it

Generated from the same OpenAPI document your instance serves, and split for on-demand reading: an index, then a file per resource, then a file per operation. The agent reads down to the operation it needs instead of loading 150 of them.

It covers workspaces, prompts, templates, skills, credentials, service tokens, agent files, providers, tags, shares and schedules.

### Install it into a local agent

Copy the directory into the agent's skills folder — for Claude Code, `~/.claude/skills/` for yourself or `.claude/skills/` inside a project:

```bash
git clone https://github.com/neutree-ai/agent-platform.git
cp -r agent-platform/skills/nap-api ~/.claude/skills/
```

Then give it what it needs to authenticate:

```bash
export NAP_BASE_URL=https://<your-nap-host>
export NAP_TOKEN=<service-token>      # ⌘K → Service Tokens
```

From there, ask in plain language — "create a workspace running Codex and point it at my openai provider", "list the agent files under /work in workspace X". The skill tells the agent which operation that means.

You can also upload it into NAP's own **Library** so hosted agents have it, which is how one agent ends up able to manage others.

### Handing a long task to a hosted agent

The skill ships a driver for the one flow that's tedious to write by hand — send a task, poll until the turn ends, print the reply:

```bash
export NAP_TOKEN=<service-token>
export NAP_BASE_URL=https://<your-nap-host>
export NAP_WS=<workspace-id>

./scripts/handoff.sh "implement what TASK.md describes"
./scripts/handoff.sh -s <session_id> "now add tests"     # continue that session
echo "long task text..." | ./scripts/handoff.sh -        # task from stdin
```

Close the laptop after that if you like. The work is running somewhere else.

## Keeping it current

It's generated, so don't hand-edit it. Regenerate against a running control plane:

```bash
cd skills
CP_SPEC_URL=http://localhost:3000/api/docs/openapi.json npm run cp
```

Regeneration wipes the skill directory and rebuilds it, then overlays the hand-authored files from `assets/nap-api/` — which is why `handoff.sh` lives there rather than in the skill itself.
