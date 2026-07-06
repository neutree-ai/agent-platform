---
title: 1. Getting Ready
description: Connect a large-model API provider — the one thing to set up before creating your first Agent
---

:::note[Don't have a running platform yet?]
These guides assume a Neutree Agent Platform instance you can sign in to. Don't have one? [Install it in one line](/self-host/single-node/).
:::

Before you create your first Agent, you need exactly one thing: a working **API provider** — the large-model API your Agent's calls go through. Each Workspace picks one provider plus a specific model, and all model calls in every Session go through that channel.

## Create an API provider

Press `⌘K` (`Ctrl+K` on Windows / Linux), search for **API Providers** and open it, then click **New API Provider**. (On a team instance an administrator may already have shared **Public** providers — if one fits, pick it and go straight to [creating your first Agent](/guides/2-first-agent/).)

The Provider Type must match the agent you plan to run and the API you have:

| Provider Type | Agent | When to use |
|---|---|---|
| **OpenAI Compatible** | Codex | Endpoints implementing the OpenAI **Responses API** — the official OpenAI API, Azure OpenAI, or a gateway that supports Responses. **Chat Completions–only services do not work**: Codex requires the Responses API. |
| **Anthropic** | Claude Code | The official Anthropic API, with a static API key. |
| **Anthropic OAuth** | Claude Code | Third-party services exposing an Anthropic-compatible API — most of them go here. Fill in the vendor's Base URL and key. Despite the name, there is **no OAuth authorization step**; the type just reuses the same protocol. |
| **Claude Code OAuth** | Claude Code | Your personal Claude Pro / Team subscription. Run `claude setup-token` locally and paste the resulting token — no Base URL needed. |

Rule of thumb: running Codex → the first row, and confirm the endpoint speaks Responses; running Claude Code → one of the other three, depending on where your access comes from (official key / third-party compatible API / personal subscription).

Fill in what the chosen type asks for and save — the provider is ready for Agents to use.

## Sharing scope

Like every shareable resource on the platform, a provider has one of three scopes: **Private** (only you), **Team** (members of a team), or **Public** (everyone on the instance). Personal keys default to Private; Public providers are usually maintained by administrators.

## Ready to go

As long as the **API Providers** list shows one usable provider, you're set — go [create your first Agent](/guides/2-first-agent/).
