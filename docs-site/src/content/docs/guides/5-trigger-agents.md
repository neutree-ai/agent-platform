---
title: 5. Triggering Agents
description: Getting an agent to start on its own — on a schedule, on an external event, through the API
---

Your agent works when you talk to it. This chapter is about getting it to **start without you** — on time, on an event, on a call from code.

The concepts behind the three, and why they're split this way, are in [Where an Agent receives tasks](/concepts/triggers-and-routes/). This is the hands-on version, easiest first:

1. **Schedules** — nothing external to depend on, the simplest there is
2. **External events** — Slack, Webhook and WeCom bringing other systems in
3. **API calls** — a Service Token, so programs can call the platform directly

## Schedules

Open the **Automation** app (`⌘K` → **Automation**), switch to **Schedules**, create one. Three fields:

- **Name** — for the list and the logs (`daily-report`, say)
- **Schedule** — a cron expression
- **Prompt** — what gets sent to the agent each time it fires

Standard five-field cron: `minute hour day month weekday`.

| Example | Meaning |
|---|---|
| `0 9 * * *` | Every day at 09:00 |
| `0 9 * * 1-5` | Weekdays at 09:00 |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 1 * *` | Midnight on the 1st |

The time zone follows your browser unless you set it.

### Worth knowing

- **Each firing is its own session** and shares no context. To carry something forward, have the agent write it to a file or into [memory](/guides/3-agent-behavior/#memory-recall-across-sessions)
- **Five minutes is a sensible floor.** The scheduler buffers, so intervals much shorter than that don't mean what they look like
- **Disabling keeps the configuration** — no need to delete a schedule to pause it

Schedules suit a morning health check, an hourly sweep of new mail, a Monday roll-up of last week.

## External events: Connectors and Routes

When an outside system (GitLab, GitHub, Jira, Slack, WeCom) wants to put an agent to work, two objects do it between them:

- **Connector** — the door events arrive at. One Connector per external system's ingress
- **Route** — a rule under that Connector, deciding which events reach which workspace and how they become a prompt

> Why it's split this way is on the [concepts page](/concepts/triggers-and-routes/#connector--route-external-systems-push-events). Here we go straight to configuring it.

### Webhook: works with almost anything

Nearly every SaaS product speaks webhooks — GitLab, GitHub, PagerDuty, Jira, CI systems of all kinds.

**1. Create a Webhook Connector**

`⌘K` → **Connectors** → new → type **Webhook**. The Connector itself needs no credentials.

**2. Create a Route**

Select the Connector, open its **Routes** tab, click **New Route**:

- **Endpoint Path** — the path to listen on (`/gitlab-ci`), which combines with the Connector into the full address
- **Workspace** — who handles what matches
- **Secret** — the signing key. The sender carries the same one, and nothing is processed until it verifies. Plain and HMAC-SHA256 are both supported (GitHub uses the latter)
- **Filter** — the conditions an event has to meet; see below
- **Prompt template** — how the request becomes a prompt

**Variables available in the template:**

| Variable | What it is |
|---|---|
| `{body}` | The whole request body |
| `{body.field}` | A nested field of it |
| `{query.key}` | A URL query parameter |
| `{headers.name}` | A request header |
| `{method}` | The HTTP method |
| `{path}` | The request path |

Leave it empty and the raw body becomes the prompt.

**3. Point the external system at it**

Put the Route's full URL into that system's webhook configuration, with the matching secret. The steps differ per product; the URL and the secret don't.

### Filter: drop it before it costs anything

Route filtering happens **before a session exists**. Events that don't match are dropped outright: no agent, no tokens.

| Operator | What it does |
|---|---|
| `=` | Exact match |
| `≠` | Not equal |
| `in` | Value is in a comma-separated list |
| `exists` | The field is present |

To handle only failed CI jobs from GitLab:

```
body.build_status = failed
body.tag = false
body.build_name ≠ sonarqube-check
```

All three have to hold, or the event is dropped.

> **Don't make the agent do the filtering.** Anything expressible as a fixed rule belongs here, so you're not opening a session and loading context just to decide there was nothing to do. Save the prompt for judgments that need reading comprehension — "don't reply if we already answered this one".

### Slack

Same shape, more credential work up front. Create an app in Slack, enable Socket Mode, and collect two tokens:

- **Bot Token** (`xoxb-...`) — from OAuth & Permissions
- **App Token** (`xapp-...`) — from Basic Information, with scope `connections:write`

The Bot Token needs `chat:write`, `channels:history`, `channels:read` and `app_mentions:read`.

Fill both in, create the Slack Connector, then attach a Route: the channel to listen on (only channels the bot has joined appear) and the target workspace.

Slack Routes also hold a thread together: consecutive messages in one thread reuse the same session, with a 24-hour TTL by default. The prompt template has more to work with than a webhook's — `{message}`, `{user}`, `{thread_context}`, `{channel}`, `{channel_name}`.

### WeCom

For teams on WeCom, a bot can be @-mentioned in a group to start an agent.

Create a **smart bot** (not a custom app) in the WeCom admin console, take its **Bot ID** and **Secret**, and fill them into the WeCom Connector.

Worth knowing: passive replies have a 24-hour window and are rate-limited to 30 messages a minute, so this isn't the path for high-frequency work.

## API calls: Service Tokens

To call an agent from code — a CI pipeline, an automation script, something you wrote yourself — use a **Service Token**.

`⌘K` → **Service Tokens** → create. The token is **shown once**. Save it then.

After that it goes in the `Authorization` header:

```
Authorization: Bearer <token>
```

The full endpoint list lives on your own instance: `⌘K` → **API Docs**, served at `/api/docs`. [REST API](/api/rest/) covers the conventions, and the [nap-api skill](/api/skills/) hands the whole surface to a local agent.

## Quick reference

| What you want | What to use |
|---|---|
| Run every day, or every hour | Schedules |
| Run when an external product emits an event | Webhook Connector + Route |
| Start it by @-mentioning a bot in Slack | Slack Connector + Route |
| Start it by @-mentioning a bot in WeCom | WeCom Connector + Route |
| Call it from code | Service Token + REST API |

## Next

Getting agents to work with each other → [Composing Agents](/guides/6-compose-agents/).
