---
title: 2. Your First Agent
description: Create a workspace from nothing and finish your first conversation
---

With a working [API provider](/guides/1-setup/) in place, your first agent takes under five minutes.

## Create a workspace

Click the workspace switcher in the top bar and choose **Create Workspace**. In the dialog:

1. Give it a **name** — `my-first-agent`, say
2. Choose a **mode**:
   - **From Template** — start from a template shared on your instance. A template carries a whole agent configuration (provider, model, prompt, sometimes skills). If one fits, take it and this step is done
   - **Blank** — configure it yourself. On a fresh install with no templates yet, this is the way, and it's only a few fields:
     - **Agent Type** — Claude Code, Codex or Goose
     - **API Provider** — the list only shows providers that work with the type you picked (the mapping is in [Getting Ready](/guides/1-setup/))
     - **Model** — one the provider actually serves
     - **Prompt** — leave it empty for now; write it once you're inside

Click **Create**.

## Go in

The workspace starts and opens on its own. The first start takes a few seconds while the platform brings up an instance for the agent.

It opens as three columns:

| Area | What it's for |
|---|---|
| Left — **Session History** | Switching between sessions, or starting one |
| Middle — working area | App tabs: **Files / Browser / Skill Studio / Terminal / Automation / Memory / Settings** — the agent's environment and configuration |
| Right — **Chat** | Where you talk to it |

Rearrange it however you like: move apps between columns, open more, or pop one into its own window. `⌘K` reaches anything.

Open any configuration item and the right side of the dialog explains its fields. When something's unclear, look there rather than coming back here.

## Your first conversation

Type into the chat box on the right:

```
Hi, introduce yourself in one sentence
```

It replies. Follow up, send images, paste links, or give it something to do:

```
List the files in the current working directory
```

It runs the command in its own environment and comes back with the result.

With no prompt written yet, it answers as a generic assistant — able to talk, with no particular way of working. Come back after you've written the prompt and it's a different agent.

## A look at Files

Open the **Files** tab in the middle column and you're looking at the agent's working directory — the files it just listed for you. What you put there it can read; what it produces shows up there for you.

Files are **shared across sessions**. Start a new session and everything is still where it was.

## Next

You have an agent that runs and holds a conversation. Making it do what you actually want comes next: a prompt for how it works, skills for its specialties, MCP to reach external systems, memory so it fits you better over time. That's [Defining Agent Behavior](/guides/3-agent-behavior/).
