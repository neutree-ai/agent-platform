---
title: 3. Defining Agent Behavior
description: Tune your Agent with Prompt, Skills, and Memory
---

By now you should already have a working Agent (if not, start with [Guide 2](/guides/2-first-agent/)). This chapter covers how to actually "tune" it — give it a specific role, have it work the way you want, know which tools to use, and remember what should be remembered.

## Configuration entry points

The **Agent Config** button at the top of the Workspace opens the configuration dialog. The left navigation has 5 areas:

| Area | Purpose |
|---|---|
| Model | Choose the large model and small model |
| Prompt | Write the system Prompt (the most important item) |
| Skills | Select which skills to enable |
| Settings | Advanced runtime parameters for the Agent engine + MCP configuration |
| Resources | CPU / memory / storage for the Agent container |

Plus the standalone **Memory** tab — it's in the Workspace top tab bar, not in the configuration dialog.

The sections below go through each in order of importance.

## Model: Your Agent's brain

The **Model** area determines which large model the Agent uses to think. The fields to choose:

- **Agent Type** — Claude Code or Codex. Claude Code uses the Anthropic protocol, Codex uses the OpenAI protocol. This choice determines which providers you can select afterward
- **API Provider** — the one you prepared in the previous chapter
- **Model** — the specific model name (for example `claude-sonnet-4-20250514` or `gpt-5.4`)
- **Small Model** — used by the Agent for lightweight internal operations (file search, code indexing, etc.). Defaults to the same as the main model; to save money you can switch it separately to a cheaper, faster small model

> **Switching the Agent Type restarts the container** — all running Sessions will be interrupted. It's recommended to stop your Sessions before switching.

A model isn't a lifetime commitment. Use a strong model for complex tasks and a fast model for simple batch tasks. Switching models in the same Workspace later is also easy — neither the Prompt nor the Skills need to change.

## Prompt: The core of behavior

The system Prompt is the single most important thing in an Agent's behavior. With the same model but a different Prompt, an Agent can behave like two completely different things.

The **Prompt** area offers two sources:

- **Write your own** — write directly in the editor
- **Reference from the library** — select a Prompt the team or you have already maintained. With referencing, when the Prompt is updated in the library, all referencing parties sync automatically

For your first time, writing your own is recommended; once you're comfortable, consider putting it in the library for reuse.

### The basic structure of a usable Prompt

A good system Prompt generally contains 4 parts:

1. **Role definition** — who you are, the scope of your responsibilities
2. **Working steps** — how to handle typical tasks step by step
3. **Output format** — what language to reply in, what structure, whether to use Markdown
4. **Constraints** — what must not be done, what must be confirmed, what must take priority

Here's a minimal example:

```text
You are a translation assistant focused on translating Chinese documents into English.

Working steps:
1. After receiving the source text, first identify the document type (technical, marketing, legal, etc.)
2. If it is a technical document, do not translate proper nouns; keep the original English terms
3. Provide the translation, comparing against the source paragraph by paragraph

Reply language: English, preserving the original paragraph structure and Markdown formatting.

Constraints:
- When you encounter a term you cannot understand, ask the user to confirm first
- Do not invent content that is not in the source text
```

This is just a starting point. A real Agent's Prompt is usually longer, including specific tool usage, principles for handling typical tasks, and fallback plans for special scenarios.

### Principles for writing Prompts

**Be concrete first, abstract later.** Writing "you are an X assistant" is far weaker than writing "your job is to clearly explain why a certain kind of event failed, and decide whether to retry automatically" — the latter spells out the scope, the goal, and the decision point in a single sentence.

**Give typical workflows, not exhaustive lists.** Don't try to list every situation the Agent might encounter. Pick 2–3 of the most typical tasks, describe the complete steps, and let the Agent generalize by analogy.

**Write constraints into the Prompt; don't wait until something goes wrong.** "Don't perform destructive operations," "always dry-run before making changes," "ask the user when something is uncertain" — these should be written in from the first version, not added after the Agent crashes.

**Iterate with real Sessions.** After writing the first version of the Prompt, run a few real tasks, see where the Agent gets stuck and what it misunderstands, then go back and revise. A mature Prompt usually takes 5–10 rounds of iteration to get right.

## Skills: Reusable capability packages

A Skill is a packaged "way of doing a certain kind of thing" — a directory containing a description file plus several tool scripts. Once enabled, the Agent loads it automatically at startup and knows the capability is available.

Open the **Skills** area of Agent Config to see the list of all available skills. Select the ones you want to enable and save. They take effect after the Agent restarts.

### When to enable a Skill

- The task **has a relatively fixed set of steps** — for example the standard usage of a certain API, or processing a certain kind of file according to some convention
- The task **is only needed in some Agents** — for example a translation Agent needs a terminology-lookup skill, but a code-review Agent doesn't, so there's no point loading it by default
- **Someone has already packaged it** — just select and use it, no need to re-teach the Agent

If a skill you need doesn't exist yet, you can create one and upload it to the library. This belongs to the "extension" and "scaling" topics — see [Guide 7: Operate at Scale](/guides/7-operate-at-scale/).

## MCP: Connecting external tools

MCP is another way to let an Agent call external tools — connecting to an independently running service via a protocol, so the tools that service exposes become capabilities the Agent can call.

There's an **MCP Configuration** section in the **Settings** area of Agent Config, where you can fill in the connection details (command or URL) of an MCP service. For how to deploy and connect an MCP service, see [Guide 4: Extending the Workspace](/guides/4-extend-workspace/).

## Memory: Recall across Sessions

By default, each Session is independent — what was learned in the last conversation isn't automatically remembered next time. Memory solves this problem.

Neutree Agent Platform uses a **Memory Store** to manage memory across Sessions. It's a standalone resource that can be attached to one or more Workspaces. For the complete design, see the [Memory Store concept page](/concepts/memory-store/); here we only cover how to use it.

### Where to find it

Two places:

- **Global Manage → Memory Store** — the account-level entry. Here you see all your memory stores, create new stores, edit entries, and view version history
- **Workspace top Memory tab** — the current Workspace view. See which stores the Workspace has attached, and temporarily attach or detach them

### The decoupled relationship between stores and Workspaces

When you create a new Workspace, the system automatically creates a memory store with the same name and attaches it — so by default what you see is "one Workspace, one store." But the relationship is decoupled:

- **A Workspace can attach multiple stores** — a user-level store (general memory such as language preferences) plus a Workspace-specific store is a common combination
- **A store can be attached to multiple Workspaces** — share the same memory across Workspaces for cross-Workspace collaboration

Migration note: the old "single Markdown per Workspace" memory has been automatically migrated into the corresponding same-named store as its first record.

### Record structure and four types

Each memory is an independent record in the store, and must have a type:

| Type | Tendency | Example |
|---|---|---|
| **user** | The user's global personality and preferences | "Reply in Chinese by default," "Follow PEP 8 for code style" |
| **feedback** | Immediate feedback received in the current conversation | "Be more concise in replies," "Don't mix Chinese and English" |
| **project** | Stable task-/project-level knowledge | "This project uses PostgreSQL, the main table is under the `app_user` database," "A `DROP TABLE` crashed last time, so always confirm before dropping tables since" |
| **reference** | A pointer to external material | "Before answering compliance questions, read https://internal-wiki/compliance first" |

Every record carries a **version**, so it's traceable and reversible.

### Content not suitable for a Memory Store

- **Changing state** — today's to-dos, the current environment variables. These should be written to files or queried dynamically
- **Secrets** — API keys, passwords. Use [credentials](/guides/1-setup/#credentials-your-agents-keys-to-resources) instead
- **Very long content** — a complete codebase description, a spec document of dozens of pages. The index goes into the context of every conversation, and being too long wastes tokens; long body content should go into sub-files for the Agent to read on demand

### How the Agent reads and writes

To the Agent, a memory store is just a **directory** in its container — mounted at `/mnt/memory/<store-name>/`. It reads and writes with ordinary file operations: `cat`, `grep`, `head`, and bash pipes all work, no need to learn a dedicated API.

Under the root of each store there's a `MEMORY.md` (uppercase) that serves as the **index** — the Agent maintains it autonomously, and the platform inlines it into the system prompt. So as soon as the Agent starts, it can see which stores are currently attached and the outline of each; to read specific content, it reads the sub-files by path.

When the Agent says in a conversation, "I've noted this down and will keep it in mind next time," it's calling this set of file operations.

### Recommended initial cleanup

If your Workspace was migrated from an older version, the first memory is usually one big block of legacy notes. Just tell the Agent:

> "The current memory was migrated from an older version. Reorganize it according to best practices."

The Agent will split, categorize, and maintain the `MEMORY.md` index on its own. It works much more smoothly after the cleanup.

## Settings and Resources

The remaining two items can generally be left at their defaults:

- **Settings** — advanced parameters of the Agent engine itself (Claude Code writes to `.claude/settings.json`, Codex appends to `~/.codex/config.toml`), plus MCP configuration. When opened, the right side shows the field descriptions for the current Agent type
- **Resources** — CPU, memory, and storage for the Agent container. The default configuration covers most scenarios; only increase it when the Agent needs to handle large files or run heavy tools

## A minimal iteration rhythm

When you're just starting to define an Agent's behavior, this order is recommended:

1. Choose a model
2. Write a Prompt that lets it **do one kind of typical task correctly**
3. Run it a few times on real cases, see where it needs more — then go back and revise the Prompt
4. Repeat step 3. Once the Prompt is basically stable, then consider adding Skills and MCP
5. Once this one Workspace is genuinely useful, extract the Prompt into the library so other Workspaces can reference it too

Avoid piling on Skills and MCP from the start. Getting the Prompt right matters more than configuring 10 skills.

## Enabling Builder Mode

[Builder Mode](/concepts/builder-mode/) lets you say things in conversation like "make the prompt clearer" or "add a schedule at 9 AM daily," and the Agent makes the changes itself while you click approve — no going back to UI forms to fill in fields. Turn it on when you need it.

**Entry point**: Workspace Settings → **MCP** tab → **Platform** card → **Builder Mode** dropdown.

Three options:

| Option | Scope | Capabilities |
| --- | --- | --- |
| **Disabled** | Off | The Agent gets no builder tools |
| **This workspace** | The current Workspace itself | Change the system prompt source, enable/disable skills, create/edit/delete commands and schedules, change the model/provider/agent type, rename, and adjust visibility |
| **Account scope** | Cross-Workspace resources under your account | Manage the Prompt library (create/edit/delete) |

The two scopes are mutually exclusive — you can only pick one at a time. "Account scope" in the current v1 only enables the Prompt library; it will expand to other account-level resources in the future.

No matter which scope you choose, once enabled the Agent automatically gains a set of **read-only** capabilities to use as the basis for its proposals:

- Read the Prompt library, Skills, and Providers visible under your account
- Read the configuration of the current Workspace (prompt source, model, enabled skills, etc.)
- Read the schedules and commands of the current Workspace
- Pull the full conversation of historical sessions for retrospective analysis (downloads JSONL on demand)

The scope option controls **what can be written**; the read layer is shared — this way the Agent can "see the current state clearly before proposing" no matter which tier is on.

Choose and save — the next time you send a message, the Agent can see the corresponding tools. Once it's on, you don't need to remember any commands either; **just describe the changes you need in natural language**:

> "Look at the last 5 chats, analyze where my system prompt is tripping you up, and propose improvements."

The Agent sends the changes to the conversation as cards, and you click *Approve* or *Reject* after reviewing. For what exactly it can do and how to use it, go back to the [Builder Mode concept page](/concepts/builder-mode/) for the full explanation.

## Next

- Want to connect your Agent to more external capabilities (MCP services, custom tabs, custom commands)? → [Guide 4: Extending the Workspace](/guides/4-extend-workspace/)
- Want the Agent to be triggered by more than just manual conversation? → [Guide 5: Triggering Agents](/guides/5-trigger-agents/)
