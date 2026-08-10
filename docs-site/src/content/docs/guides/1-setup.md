---
title: 1. Getting Ready
description: Connect a model API provider — the one thing to set up before your first agent
---

:::note[Don't have a running platform yet?]
These guides assume a Neutree Agent Platform instance you can sign in to. Don't have one? [Install it in one line](/self-host/single-node/).
:::

One thing has to exist before your first agent: a working **API provider**, the model API its calls go through. Each workspace picks one provider and one model on it, and every session's model calls take that route.

## Create an API provider

Press `⌘K` (`Ctrl+K` on Windows / Linux), find **API Providers**, and click **New API Provider**. (On a team instance an administrator may have shared **Public** providers already — if one fits, take it and go straight to [your first agent](/guides/2-first-agent/).)

The provider type has to match both the core you plan to run and the API you actually have:

| Provider type | Core | When to use it |
|---|---|---|
| **Anthropic API** | Claude Code | The official Anthropic API, with a static key. |
| **Anthropic OAuth** | Claude Code | Third-party services exposing an Anthropic-compatible API — most of them land here. Base URL plus key. Despite the name there is **no OAuth step**; the type just reuses the protocol. |
| **Claude Code OAuth** | Claude Code | Your personal Claude Pro / Team subscription. Run `claude setup-token` locally and paste the token. No Base URL needed. |
| **OpenAI Responses** | Codex | Endpoints that speak the OpenAI **Responses** API (`/v1/responses`) — the official OpenAI API, Azure OpenAI, or a compatible endpoint. **Chat Completions alone will not do**: Codex needs Responses. |
| **OpenAI Chat Completions** | Goose | Endpoints that speak `/v1/chat/completions`. This is the one Goose uses. |

The short version: Claude Code takes one of the three Anthropic rows, depending on where your access comes from — official key, third-party compatible API, or personal subscription. Codex needs Responses. Goose needs Chat Completions. The two OpenAI rows are not interchangeable.

Fill in what the type asks for and save. The provider is ready.

## Sharing scope

Like every shareable resource here, a provider is **Private** (just you), **Team** (a team's members), or **Public** (everyone on the instance). Personal keys default to Private; Public providers are usually an administrator's.

## Ready to go

One usable provider in the **API Providers** list is all you need. Go [create your first agent](/guides/2-first-agent/).
