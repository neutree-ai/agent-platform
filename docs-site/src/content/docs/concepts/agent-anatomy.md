---
title: Anatomy of an Agent
description: What Model, Prompt, Skills, MCP, and Memory each handle
---

There are five things you can tune to shape an Agent's behavior. These five don't sit at the same level — sort out the levels first, and writing prompts and picking tools later will go more smoothly.

## Model: the Agent's brain

The Model determines how smart the Agent is, what its style is like, and how expensive it is. With the same prompt and the same set of skills, swapping the model can make a big difference in performance.

NAP isn't tied to a specific vendor. You connect a model API into the platform through a **Provider** — it can be the team's centrally procured API gateway, your own Anthropic / OpenAI key, OpenRouter, Azure OpenAI, or any OpenAI-compatible endpoint. An Agent picks one Provider and one specific model.

Advanced: you can also configure a **Small Model** for an Agent — used for lightweight internal operations like file search and code indexing, to save money. The Agent itself decides when to use the big brain and when to use the small one.

## Prompt: identity and way of working

The System Prompt is an Agent's most important configuration. It tells the Agent **who you are and how you work** — role definition, the steps for doing things, output format, safety constraints.

The Prompt can be written directly in the Workspace, or it can reference a shared one from the **Prompt Library**. When you use a reference, any update to the Prompt automatically syncs to all Agents that reference it — this is the foundation of operating at scale.

Writing a good prompt is itself a sizable topic; [Guide 3](/guides/3-agent-behavior/) covers how to write one separately.

## Skills: reusable sub-procedures

A Skill is a **packaged "method for doing a certain class of thing"** — a directory containing a `SKILL.md` description file plus a handful of tool scripts. Once a skill is enabled, its files are mounted into the Agent's container, and the Agent automatically reads `SKILL.md` at startup, learning that this capability is available.

A few examples: packaging a set of common GitLab API operations into a `gitlab-api` skill; packaging the standard troubleshooting steps for diagnosing a certain class of service failure into a skill that you enable with one click when needed; packaging the authentication and call details for integrating with a third-party SaaS into a skill, so the agent doesn't have to figure it out from scratch each time.

When a Skill fits: **the task has relatively fixed steps or knowledge, but it isn't worth loading by default for every Agent.** Just check it on to enable it when needed. Skills are managed centrally in the **Library**, support uploading an archive or importing from a Git repository, and are shared by all Agents.

## MCP: the gateway to external tools

MCP (Model Context Protocol) is a standardized protocol that lets an Agent invoke the capabilities of **external services**. You give the Agent the connection details for an MCP Server (a command or URL); the Agent connects to it at startup, and all the tools that server exposes become tools the Agent can call.

People often can't tell MCP and Skill apart; the difference is:

- A **Skill** is files mounted into the container that the Agent reads and executes itself — suited for "procedural, knowledge-based" capabilities
- **MCP** is a protocol-level call to an external service — suited for capabilities that "connect to external systems, cross the network, and have their own state"

For example: a guide for "querying a certain knowledge base according to a convention" (a file is enough) is well suited as a Skill; a service that runs independently and has its own API and data (such as Grafana) is well suited as an MCP.

## Memory: long-term memory across Sessions

By default, each Session is independent — what the Agent learned in the last conversation won't automatically be remembered in the next. Memory solves this.

NAP's Memory takes the form of a **Memory Store** — an independent resource that can be mounted on one or more Workspaces. Each store holds multiple versioned records, classified into four categories: user / feedback / project / reference. To the Agent, a Memory Store is mounted in the container as a **file directory** (`/mnt/memory/<store>/`), and can be operated on with familiar methods like grep, bash pipes, and on-demand reads.

"The user prefers Chinese," "this project's code style is X," "the pitfall we hit last time" — these are well suited to Memory and shouldn't have to be restated by the user each time. The Agent can also write to the Memory Store itself (via a platform built-in tool).

For the full concept and how it works, see [Memory Store](/concepts/memory-store/).

## How the five-piece set fits together

- **Model** is the foundation, setting the baseline
- **Prompt** is the contract, deciding the Agent's persona and working framework
- **Skills** are on-demand "specialties"
- **MCP** is the bridge "out to the external world"
- **Memory** is the experience the Agent accumulates for itself

A typical order: first pick the Model and write the Prompt to get the simplest version working, then add Skills and MCP as needed to extend capabilities, and finally use Memory to make it understand you better the more it's used.
