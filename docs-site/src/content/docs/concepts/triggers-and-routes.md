---
title: Where an Agent receives tasks
description: The three triggering mechanisms — Web UI, Schedule, and Connector + Route
---

Once a Workspace is created, how does the Agent start working? NAP offers three triggering mechanisms, covering everything from "a human uses it manually" to "fully unattended."

## Three triggering mechanisms

| Triggering mechanism | Who calls it | Typical scenario |
|---|---|---|
| **Web UI** | You start a conversation in your browser | Daily debugging, ad-hoc tasks, exploratory use |
| **Schedule** | The platform fires on a cron expression | Run a report every morning, check status every hour |
| **Connector + Route** | An external system sends events in via Slack / Webhook | Diagnose when a GitLab pipeline fails, respond when a Slack message arrives |

No matter which one it is, the result is the same: **open a new Session in the Workspace and hand the task to the Agent as the initial prompt.** The Agent doesn't know or care who called it — which is why these triggering mechanisms can be freely combined.

## Web UI

The simplest case. Open the Workspace, type text into the conversation box, paste an image, or enter a `/command` — and a Session begins.

Suited for: when you haven't fully thought through the task, when you need to adjust as you converse, or when you want to watch the Agent do each step. For all new Agents we recommend first getting them working via the Web UI before considering how to automate.

## Schedule: fire on time

You configure one or more scheduled tasks on a Workspace, each task being a pair of `(cron expression, prompt)`. When the time comes, the platform automatically creates a new Session in this Workspace and sends out the prompt.

Schedule is the **cheapest form of automation** — zero external dependencies, no system integration required, as long as the Agent can complete the task on its own. Common uses: have the Agent inspect system status every morning, pull and summarize new email every hour, aggregate last week's data every Monday.

Each trigger is an independent Session and doesn't share context. If you need to "continue from where you left off last time," you should use Memory or write state to a file, rather than relying on Session context.

## Connector + Route: external systems push events

This is the most powerful and also the one that needs the most explanation. It solves: "when a GitLab pipeline fails, I want to automatically trigger an Agent to diagnose it" — letting external systems send events into NAP.

For external events to come in, three questions need answering:

- **Where do they come in** — NAP exposes an endpoint waiting to receive
- **Who handles them once in** — which Workspace a given event should go to
- **How they become something the Agent understands** — how an HTTP request or Slack message turns into a prompt

NAP uses two objects to answer these three questions:

### Connector: the receiving endpoint

A Connector is a "receiving end." NAP currently supports two types:

- **Webhook** — exposes an HTTP endpoint that external systems POST to. Requires configuring a secret for signature verification
- **Slack** — connects a Slack bot and listens for messages that @ that bot

A Connector is a "door." The door itself doesn't decide what happens behind it — that's the Route's job.

### Route: routing rules

Multiple Routes can hang off a single Connector. Each Route defines:

- **Which event it matches** — a Webhook uses path + filter rules (such as `body.build_status = failed`); Slack uses a specific channel
- **Which Workspace it triggers**
- **How it turns the event into a prompt** — a template that can reference variables like `{body}`, `{message}`, `{user}`

A concrete example: GitLab has a webhook configured on a repo that sends to NAP, and the Route on the NAP side sets `path = /ci-doctor`, filter = `build_status = failed`, workspace = `ci-doctor`, prompt template = `Here is this CI job event data: {body}`. Each time a job fails, GitLab sends the event over, and after NAP matches the path and the filter passes, it opens a new Session in the corresponding Workspace to trigger the diagnosis.

### Why Filter matters

Filtering happens at the Route layer, **done before the Session is even opened**. Non-matching events are dropped directly — no Agent started, no tokens burned.

You could also let the Agent decide for itself whether "this event should be handled" — but having to open a Session, load context, and call a large model every time just to "take a look and then decide not to act" is an obvious waste. The principle is: **if a filter condition can be written clearly with fixed rules, put it in the Route Filter.** Reserve the Agent prompt for the complex judgments that require semantic understanding.

## Where Provider fits

A Provider is not a triggering mechanism — it's the foundation the Agent uses to call a large-model API when it's running. You can think of it this way: the triggering mechanism decides "when to call the Agent to work," and the Provider decides "what the Agent thinks with when it works." These are two independent things.

Each Workspace picks one Provider. Providers are managed centrally under **Management → Providers**; see [Guide 1](/guides/1-setup/) for details.

## The full picture of how they relate

<pre class="mermaid">
flowchart TD
  UI["Web UI (manual conversation)"]
  SCH["Schedule (cron trigger)"]
  CR["Connector + Route (external system push)"]
  S(("New Session"))
  A["Agent (running inside Workspace)"]

  UI --> S
  SCH --> S
  CR --> S
  S --> A
</pre>

Next, head to [Guide 5](/guides/5-trigger-agents/) for the specific configuration steps of each triggering mechanism.
