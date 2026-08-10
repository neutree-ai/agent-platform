---
title: Where an Agent receives tasks
description: The four ways work reaches an agent — web UI, Schedule, Connector + Route, and the HTTP API
---

A workspace exists. How does the agent start working? NAP has four ways in, covering everything from a person typing to nobody being there at all.

## The ways in

| Way in | Who calls it | Typical use |
|---|---|---|
| **Web UI** | You, starting a conversation in the browser | Everyday debugging, one-off tasks, exploring |
| **Schedule** | The platform, firing on a cron expression | A report every morning, a status check every hour |
| **Connector + Route** | An external system, sending events in via Slack / WeCom / Webhook | A GitLab pipeline fails and gets diagnosed, a Slack message gets answered |
| **HTTP API** | Your own code, holding a Service Token | A CI pipeline, a script, a tool you wrote |

Whichever it is, the outcome is the same: **a new session opens in the workspace and the task arrives as the first prompt.** The agent neither knows nor cares who called it, which is why these three combine freely.

## Web UI

The simplest case. Open the workspace, type into the conversation box, paste an image, or run a `/command`. A session begins.

Good for tasks you haven't fully thought through, work you want to steer as it goes, or watching each step. For any new agent, get it working here before automating it.

## Schedule: fire on time

A workspace can carry one or more schedules, each a pair of `(cron expression, prompt)`. When the time comes, the platform opens a new session in that workspace and sends the prompt.

Schedule is **the cheapest automation there is** — nothing external to depend on, nothing to integrate, as long as the agent can finish the job alone. Common shapes: check system status every morning, pull and summarize new mail every hour, roll up last week's numbers every Monday.

Each firing is its own session and shares no context with the last. To carry something forward, use memory or write it to a file rather than leaning on session context.

## Connector + Route: external systems push events

The most capable of the three, and the one that needs the most explaining. It answers "when a GitLab pipeline fails, I want an agent to look at it" — letting outside systems send events in.

Getting an event in means answering three questions:

- **Where does it arrive** — NAP has to expose something listening
- **Who handles it** — which workspace this particular event belongs to
- **How does it become something the agent can act on** — how an HTTP request or a Slack message turns into a prompt

Two objects answer all three.

### Connector: the receiving endpoint

A Connector is the receiving end. Three types today:

- **Webhook** — an HTTP endpoint external systems POST to, with a secret configured for signature checks
- **Slack** — a Slack bot, listening for messages that @ it
- **WeCom** — a WeCom bot; @-mentioning it in a group triggers the agent

A Connector is a door. What happens behind the door is the Route's business.

### Route: routing rules

One Connector can carry many Routes. Each Route says:

- **Which events it matches** — a Webhook matches on path plus filter rules (`body.build_status = failed`, say); Slack matches on a channel
- **Which workspace it triggers**
- **How the event becomes a prompt** — a template that can pull in `{body}`, `{message}`, `{user}`

Concretely: GitLab has a webhook on a repo pointing at NAP; the Route on the NAP side sets `path = /ci-doctor`, filter `build_status = failed`, workspace `ci-doctor`, and a prompt template of `Here is this CI job event data: {body}`. A job fails, GitLab sends the event, NAP matches the path, the filter passes, and a new session opens in that workspace to start the diagnosis.

### Why the filter matters

Filtering happens in the Route, **before a session ever opens**. Events that don't match are dropped: no agent started, no tokens spent.

You could let the agent decide whether an event is worth handling — but opening a session, loading context and calling a model just to conclude "not this one" is waste you can see. The rule of thumb: **if a condition can be written down as a fixed rule, it belongs in the Route filter.** Save the prompt for judgments that actually need reading comprehension.

## HTTP API: your own code calls in

The three above are things you configure. The fourth is something you write against: a **Service Token** authenticates a request, and a workspace takes it as a turn. That's how a CI pipeline, a cron job on your own machine, or an internal tool starts an agent — no Connector to set up, because the caller is code you control.

Turns can stream back, or the API can hand the whole turn off and return when it's done. See [Triggering Agents](/guides/5-trigger-agents/) for the token and the endpoints.

## Where Provider fits

A Provider isn't a way in. It's what the agent thinks with once it's running. The way in decides *when the agent works*; the Provider decides *what it works with*. Two independent things.

Each workspace picks one Provider. They're managed in the **API Providers** app (`⌘K` → **API Providers**); see [Getting Ready](/guides/1-setup/).

## How they relate

<pre class="mermaid">
flowchart TD
  UI["Web UI (a person types)"]
  SCH["Schedule (cron fires)"]
  CR["Connector + Route (an external system pushes)"]
  API["HTTP API (your code calls, with a Service Token)"]
  S(("New session"))
  A["Agent (running inside the workspace)"]

  UI --> S
  SCH --> S
  CR --> S
  API --> S
  S --> A
</pre>

Next: [Triggering Agents](/guides/5-trigger-agents/) has the setup steps for each.
