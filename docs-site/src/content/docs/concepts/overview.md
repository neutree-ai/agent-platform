---
title: What is Neutree Agent Platform
description: A hosted, multi-user home for the agents you already run, on infrastructure you own
---

Most people meet an Agent on their own machine: one terminal, one person, one session at a time. That works right up to the point where the Agent has to be there while the laptop is closed, or where someone on another team wants the same one.

Neutree Agent Platform (NAP) is where that Agent goes next. **Close your laptop. Your agents keep working.** The core, the prompt and the skills stay the ones you already use — what changes is that they run as a hosted, multi-user service inside a Kubernetes cluster you control, online around the clock, waiting for you or an external system to hand over work.

## What the platform takes care of

A prototype Agent is easy: a script, a prompt, a few API calls. Turning it into something a team leans on every day is a different job, and almost none of that job is about what the Agent actually does:

- **Always on** — not a script that runs when someone remembers to start it
- **Reachable** — a Slack thread, an HTTP call, a CI webhook, a schedule. Five entrances, one Agent
- **Contained** — it can run shell, read files and install tools, but inside a boundary you set
- **Shared** — a prompt one person tuned is one the rest of the team points at, rather than copies
- **Not welded to one vendor** — the core is swappable, and the configuration belongs to the Workspace rather than to the core running it

That half is the platform's. Yours is deciding what the Agent should do.

## The life of an Agent: Build → Distribute → Optimize

Running an Agent on NAP means going around these three repeatedly, and the docs are organized along the same thread:

- **Build** — a neutral, swappable core, shaped by a prompt, skills and MCP, on top of middleware the platform runs so no Agent has to ship its own. Start with [your first Agent](/guides/2-first-agent/).
- **Distribute** — one Workspace, reachable five ways, served in whichever shape the workload needs. Nothing on the user's side: no install, no configuration, no key of their own. See [Triggering Agents](/guides/5-trigger-agents/).
- **Optimize** — the Agent reads its own session history and proposes changes to its prompt and skills. Nothing lands until you approve it. See [Optimize](/concepts/optimize/).

## Terms that run through the whole site

Four sets of words come up again and again. Getting familiar with them is enough for now; each set has a chapter of its own later on:

- **Workspace / Agent / Session** — A Workspace is the Agent's desk, holding its configuration, its files and its conversation records. An Agent is what that configuration becomes once it runs. A Session is one conversation or one task.
- **Model / Prompt / Skills / MCP / Memory** — The five-piece set: brain, identity, muscle memory, external tools, long-term memory. These five are what you tune.
- **Middleware** — What the platform runs underneath every Workspace, so no Agent has to carry it: [code sandbox](/self-host/sandbox-browser/), remote browser, Agent-to-Agent calls, [cross-agent filesystem](/concepts/afs/), [memory store](/concepts/memory-store/), MCP connections. You switch these on; you don't build them.
- **Provider / Connector / Route / Schedule** — Where the Agent picks up work. A Provider connects it to a model API, a Connector plus a Route bring external events in, a Schedule starts it on time.

## Design philosophy: each layer minds its own segment

These layers are kept apart on purpose. The Agent core (Claude Code / Codex / Goose) is separate from the model, the Agent's configuration is separate from what triggers it, and a single Agent is separate from the team's reusable resources (Library). The cost is a few more terms to remember. The benefit shows up when one layer has to change: swap the core and the prompt, the skills and the schedule come along untouched, because they belong to the Workspace. Lose access to a model API and a different Provider carries on from there.

## What to read next

- Want a complete mental model first → read the [Concepts](/concepts/agent-and-workspace/) chapter in order, about 10 minutes
- Want to get hands-on → jump to [Getting Ready](/guides/1-setup/) and get your first Agent running
