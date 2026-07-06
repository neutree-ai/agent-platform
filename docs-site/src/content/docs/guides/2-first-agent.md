---
title: 2. Your First Agent
description: Create a Workspace from scratch and complete your first conversation
---

Once you have a working [API provider](/guides/1-setup/), you can create your first Agent. The whole process takes less than 5 minutes.

## Create a Workspace

Click the workspace switcher in the top menu bar and choose **Create Workspace**. In the dialog:

1. Fill in the **name** — for example `my-first-agent`
2. Choose a **mode**:
   - **From Template** — start from a template shared on your instance. A template carries a complete Agent configuration (provider, model, prompt, possibly skills); if a suitable one exists, pick it and you're done with this step
   - **Blank** — configure from scratch. On a fresh install with no templates yet, this is your path — it's only a few fields:
     - **Agent Type** — Claude Code or Codex
     - **API Provider** — the list only shows providers compatible with the chosen agent type (the mapping from [Getting Ready](/guides/1-setup/))
     - **Model** — pick one the chosen provider actually serves
     - **Prompt** — fine to leave empty; write it after you enter the Workspace

Click **Create**.

## Enter the Workspace

Once created, the Workspace starts and opens automatically. The first startup takes a few seconds — the platform is preparing a running instance for your Agent in the background.

By default the Workspace opens as three columns:

| Area | Purpose |
|---|---|
| Left — **Session History** | Switch between or start sessions |
| Middle — working area | App tabs: **Files / Browser / Skill Studio / Terminal / Automation / Memory / Settings** — the Agent's environment and configuration all live here |
| Right — **Chat** | Where you talk to the Agent |

The layout is yours to rearrange — move apps between columns, open more of them, or pop one out into its own window. `⌘K` gets you anywhere.

When you open any configuration item, the right side of the dialog shows the corresponding field descriptions. Whenever you're unsure about something, just look at the right side — you don't need to switch back to this document.

## Your first conversation

Type a message in the Chat input on the right:

```
Hi, please introduce yourself in one sentence
```

The Agent will reply. You can follow up, send images, paste links, or have it do simple things:

```
List all files in the current working directory for me
```

The Agent will run a command in its environment and reply with the result.

If the prompt isn't written yet, the Agent responds as a generic assistant — it can chat but has no specific work style. Come back to talk to it after you finish the prompt, and you'll see a completely different Agent.

## A look at Files

Open the **Files** tab in the middle column and you'll see the Agent's working directory — these are exactly the files it saw when you asked it to "list files." Anything you put here, the Agent can read; anything it produces shows up here for you.

Files are **shared across Sessions**: when you start a new Session, everything is still in place.

## Next

At this point you have an Agent that runs and can converse. The next step is making it do what you actually want — write a prompt to give it a "personality" and a way of working, add skills to give it specialties, configure MCP to connect it to external systems, and use memory so it understands you better the more you use it. All of this is in [Defining Agent Behavior](/guides/3-agent-behavior/).
