---
title: What is Neutree Agent Platform
description: An Agent Cloud that lets Agents truly run inside your company
---

You already know what the cloud is — with software, you don't have to buy your own servers, configure networking, or run operations; the cloud handles all of that and you just write the business logic. Neutree Agent Platform (NAP) does the same thing, only it swaps the object from software to Agents: the runtime environment, triggering, collaboration, and reuse are all handled by the platform, and you only need to define "what this Agent should do."

This is the **Agent Cloud**. The Agents you create run inside a Kubernetes cluster, online 24/7, waiting for you or external systems to hand them tasks.

## What it solves

Writing a working prototype Agent isn't hard — a Python script, a prompt, and a few API calls are enough. But turning it into something that "the team uses every day, integrates with existing systems, can be debugged when it breaks, and new people can modify" is where things get tricky:

- It has to be **always online**, not a script that only runs when you manually start it
- It has to be **triggerable by external systems** — a GitLab job failed, a Slack message arrived, a scheduled time was reached
- It has to have a **controllable execution environment** — able to run shell, read files, and install tools, but not run wild
- It has to be **reusable by the team** — a prompt one person tuned should be directly usable by others
- It has to **not be locked into a single vendor** — today you use Claude, tomorrow some new model from OpenAI might be cheaper

NAP consolidates all of this into one platform. You focus on "what this Agent should do," and leave the rest to the platform.

## The life of an Agent: Build → Distribute → Optimize

Running an Agent on NAP means going through these three stages repeatedly — and the docs are organized around this main thread:

- **Build** — define who it is and what it can do: model, prompt, skills, external tools, human-in-the-loop interface. Start with [your first Agent](/guides/2-first-agent/).
- **Distribute** — make it usable anytime, anywhere: scheduled, external events, API triggers, multi-Agent collaboration, team reuse. See [Trigger Agents](/guides/5-trigger-agents/).
- **Optimize** — make it better the more it's used: review real session history, continuously drive down per-task cost and raise task success rate. See [Optimize](/concepts/optimize/).

## Three sets of terms that run through the whole site

After reading the full set of docs, you'll repeatedly encounter these three sets of terms — just get familiar with them for now; each set has a dedicated chapter that expands on it later:

- **Workspace / Agent / Session** — A Workspace is the Agent's "desk," holding its configuration, files, and conversation records. An Agent is the instance that results from running that configuration. A Session is one specific conversation or task.
- **Model / Prompt / Skills / MCP / Memory** — The five-piece set, respectively determining the Agent's "brain, identity, muscle memory, external tools, and long-term memory." These five are what you can tune.
- **Provider / Connector / Route / Schedule** — These determine where the Agent receives tasks from. A Provider connects it to a large-model API; a Connector + Route bring external events in; a Schedule lets it start itself on time.

## Design philosophy: each layer manages its own segment

These sets of concepts are deliberately kept separate. The Agent engine (Claude Code / Codex) is separate from the model, the Agent configuration is separate from the triggering mechanism, and a single Agent is separate from the team's reusable resources (Library). The cost is having to remember a few more terms; the benefit is that when you later want to swap out one of those layers, the others basically don't have to change — for example, if one day a model API becomes unavailable, you just switch to a different Provider and carry on, while the prompt and skills stay untouched.

## What to read next

- Want to build a complete mental model first → read through the [Concepts](/concepts/agent-and-workspace/) chapter in order, about 10 minutes
- Want to get hands-on immediately → jump to [Guide 1: Setup](/guides/1-setup/) and get your first Agent running
