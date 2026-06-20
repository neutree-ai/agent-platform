---
title: 1. Getting Ready
description: API providers and credentials — the bare minimum to prepare before using Neutree Agent Platform
---

Before you create your first Agent, there are two things to confirm:

1. **You have a working API provider** — once an Agent is running, it needs to call a large-model API
2. **(Optional) Credentials for the resources your Agent will access are ready** — for example, to operate a private Git repository, call an internal API, or sign in to a third-party service

The second item is on-demand; the vast majority of new users only need to take care of the first.

## API Providers: Your Agent's gateway to large models

An API provider is the large-model API gateway you configure for Neutree Agent Platform. It tells the platform where to call, which key to use, and what protocol to follow. Each Workspace picks one provider plus a specific model (for example `gpt-5.4`), and all model calls across every Session go through this channel.

### Check the existing providers first

Open **Manage → API Providers** in the sidebar. There are usually already providers shared by the team or the platform (marked **Public**). These are preconfigured by platform administrators, and you can use them directly.

If the list already has a suitable provider, you can jump straight to [Guide 2](/guides/2-first-agent/) and create an Agent.

### Create your own provider

If the shared providers don't meet your needs (you want to bill against your own API key, or connect a service the team hasn't), click **New API Provider** to create a Private provider. Pick one from Provider Type:

| Protocol Type | When to use |
|---|---|
| **OpenAI Compatible** | The official OpenAI API, Azure OpenAI, OpenRouter, and various large-model gateways — anything compatible with the OpenAI protocol falls into this category. The Codex agent must use this type. |
| **Anthropic** | Direct connection to the official Anthropic API using a static API Key. |
| **Anthropic OAuth** | A third-party service that offers an Anthropic-compatible protocol and requires OAuth authorization. |
| **Claude Code OAuth** | Authorize with your personal Claude Pro / Team subscription, no API Key required. |

After filling in the Base URL and API Key and saving, the provider is ready to be used by an Agent.

### Public or Private

- **Private** — only you can use it; suitable for a personal API key or a gateway you don't want to share
- **Public** — every user on the platform can use it; suitable for quotas the team procures centrally and wants everyone to access

Regular users default to Private. Public providers are usually maintained by administrators.

## Credentials: Your Agent's keys to resources

A provider lets an Agent "think"; credentials let an Agent "do things" — access private Git repositories, call internal APIs, read cloud storage, sign in to databases, and so on. Every external resource that requires authentication relies on credentials.

Credentials are managed under **Manage → Credentials** in the sidebar, with three injection methods:

- **env** — write the value into an environment variable (such as `GITHUB_TOKEN`, `DATABASE_URL`)
- **file** — write the value into a file inside the container (such as `~/.gitconfig`, `credentials.json`)
- **SSH Key** — a shortcut for creating a private-key credential, automatically placed in the standard location (`~/.ssh/id_ed25519`)

Once a credential is created, select which ones to use in a Workspace. When the Agent starts, it automatically injects these credentials into the container.

### Do you need this step?

- If your first Agent only uses a large model to answer questions (such as summarizing text or drafting emails), you don't need any credentials — go straight to the next chapter
- If your Agent needs to access internal resources (Git, internal APIs, SaaS accounts), come back to configure this once you've thought through what you want to do

## Ready to go

It boils down to one sentence: as long as there's a usable provider under **Manage → API Providers**, you're set. Head over to [Guide 2: Your First Agent](/guides/2-first-agent/).
