---
title: 2. Your First Agent
description: Create a Workspace from scratch and complete your first conversation
---

Once the API provider mentioned in [Guide 1](/guides/1-setup/) is ready, you can create your first Agent. The whole process takes less than 5 minutes.

## Create a Workspace

Click **Create Workspace** in the sidebar, and in the dialog:

1. Fill in the **name** — for example `my-first-agent`
2. Choose a **mode**:
   - **Create from template** — create from a preset template. The template already contains a complete Agent configuration (API provider, model, Prompt, and possibly skills), which is great for getting started
   - **Blank** — choose the API provider, model, and Prompt from scratch. Suitable when you already know exactly how you want to configure things

For your first time, **Create from template** is strongly recommended. If the platform has a template named `quick-start`, just pick it — it's the minimal usable configuration prepared for new users.

If there are no templates at all, choose **Blank**, then:

- **API Provider** — choose the one you prepared in the previous chapter
- **Model** — choose a specific model (for example `gpt-5.4`)
- **Prompt** — you can leave it empty for now and write it after you enter the Workspace

Click **Create**.

## Enter the Workspace

Once created, the Workspace starts and opens automatically. The first startup takes a few seconds — Neutree Agent Platform is preparing a running instance for your Agent in the background.

After startup completes, you'll see several areas:

| Area | Purpose |
|---|---|
| Top tab bar | **Files / Terminal** is the Agent's runtime environment; **Agent Config / Automation / Memory** are configuration entry points |
| Center main area | The content of the currently open tab |
| Right conversation panel | Where you talk to the Agent |
| Top session bar | Switch between or create new sessions |

When you open any configuration item, the right side of the dialog shows the corresponding field descriptions. Whenever you're unsure about something, just look at the right side — you don't need to switch back to this document.

## Your first conversation

If you used the `quick-start` template, the prompt is already in place. Just type a message in the input box at the bottom right:

```
Hi, please introduce yourself in one sentence
```

The Agent will reply. You can follow up, send images, paste links, or have it do simple things:

```
List all files in the current working directory for me
```

The Agent will run a terminal command to look, and reply with the result.

If the prompt isn't written yet, the Agent responds as a generic assistant — it can chat but has no specific work style. Come back to talk to it after you finish the prompt, and you'll see a completely different Agent.

## A look at Files and Terminal

Switch to the **Files** tab at the top and you'll see all the files under the Agent's working directory — these are exactly what it saw when you asked it to "list files."

Switch to the **Terminal** tab and you can drop straight into the shell of the Agent's container. Commands run here and commands run by the Agent itself are in the same environment — if you write a file, the Agent can read it next time.

Files and Terminal are **shared across Sessions**: when you create a new Session, the files are still in place.

## Next

At this point you have an Agent that runs and can converse. The next step is making it do what you actually want — write a prompt to give it a "personality" and a way of working, add skills to give it specialties, configure MCP to connect it to external systems, and use memory so it understands you better the more you use it. All of this is in [Guide 3: Defining Agent Behavior](/guides/3-agent-behavior/).
