---
title: Anatomy of an Agent
description: What Model, Prompt, Skills, MCP and Memory each take care of
---

Five things shape how an agent behaves. They don't sit at the same level, and sorting the levels out first makes writing prompts and picking tools go more smoothly later.

## Model: the agent's brain

The model sets how sharp the agent is, how it writes, and what it costs. Same prompt, same skills, different model — the difference in the result can be large.

NAP is not tied to a vendor. You bring a model API in through a **Provider**: the endpoint your team already procured, your own Anthropic / OpenAI key, OpenRouter, Azure OpenAI, or anything else compatible. The [provider type has to match the core](/guides/1-setup/), so check the mapping there. An agent picks one Provider and one model on it.

Beyond that, an agent can also carry a **Small Model** for cheap internal work like file search and code indexing. The agent decides for itself when the big brain is needed and when the small one will do.

## Prompt: identity and way of working

The system prompt is the agent's most consequential setting. It says **who it is and how it works**: the role, the steps, the output format, the limits it stays inside.

You can write the prompt into the workspace directly, or point it at a shared one in the **Prompt Library**. Point at one and every update follows through to each agent referencing it — that reference is what makes running many agents tractable.

Writing one well is a topic of its own; [Defining Agent Behavior](/guides/3-agent-behavior/) covers it.

## Skills: reusable sub-procedures

A skill packages **a way of doing one class of thing**: a directory with a `SKILL.md` description and a handful of tool scripts. Enable it and the files are mounted into the agent's container; the agent reads `SKILL.md` at startup and knows the capability is there.

Some examples: the GitLab API calls you keep repeating, wrapped as a `gitlab-api` skill; the standard triage steps for one class of service failure, ready to switch on the day it happens; the auth and call details for a third-party SaaS, so the agent doesn't rediscover them every time.

A skill fits when **the steps or the knowledge are fairly fixed, but not worth loading into every agent by default**. Tick it on when you need it. Skills live in the **Library**, arrive by archive upload or Git import, and are shared across agents.

## MCP: the way out to external tools

MCP (Model Context Protocol) is a standard for calling **external services**. Give the agent an MCP server's connection details (a command or a URL) and it connects at startup; everything that server exposes becomes a tool the agent can call.

Skills and MCP get mixed up often. The line between them:

- A **skill** is files in the container that the agent reads and runs itself — good for procedural, knowledge-shaped capability
- **MCP** is a call across the wire to a service — good for capability that lives outside, holds its own state, and is somebody else's to run

A convention for querying an internal knowledge base is a file, so it's a skill. Grafana runs on its own with its own API and data, so it's an MCP.

## Memory: long-term memory across sessions

Sessions are independent by default: what the agent worked out last time is not there the next time. Memory is what closes that gap.

Memory in NAP takes the shape of a **memory store** — a resource of its own that mounts onto one workspace or several. A store holds many records, each versioned, each typed as user / feedback / project / reference. The agent sees a store as a **directory** in its container (`/mnt/memory/<store>/`), which it reads and writes with grep, pipes and on-demand reads.

"This user writes in Chinese", "this project's code style is X", "the thing that bit us last time" — all worth keeping, none worth the user repeating. The agent can write to the store itself through a built-in platform tool.

For the whole concept and how it works underneath, see [Memory Store](/concepts/memory-store/).

## How the five fit together

- **Model** sets the baseline
- **Prompt** is the contract: who the agent is and how it works
- **Skills** are specialties, loaded on demand
- **MCP** is the way out to systems you don't run
- **Memory** is what the agent accumulates for itself

The usual order: pick the model and write the prompt until the simplest version works, add skills and MCP as the job demands, then let memory make it fit you better the longer it runs.
