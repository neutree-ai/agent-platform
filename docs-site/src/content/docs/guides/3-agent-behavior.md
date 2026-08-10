---
title: 3. Defining Agent Behavior
description: Shaping an agent with its prompt, its skills and its memory
---

You should have a working agent by now (if not, start with [your first agent](/guides/2-first-agent/)). This chapter is about shaping it: giving it a role, a way of working, the right tools, and a memory of what matters.

## Where the configuration lives

Open the **Settings** app in the workspace (middle column by default; `⌘K` → **Settings** works from anywhere). Seven areas down the left:

| Area | What it covers |
|---|---|
| General | Workspace basics and lifecycle (start / stop / restart) |
| Model | Agent type, provider, models |
| Prompt | The system prompt — the one that matters most |
| MCP | External tool services, and platform capabilities like builder mode |
| Skills | Which skills are enabled |
| Resources | CPU / memory / storage for the container |
| Agent settings | Advanced runtime parameters of the core |

Memory has its own **Memory** app; it isn't under Settings.

What follows goes through them in order of how much they matter.

## Model: the agent's brain

The **Model** area decides what the agent thinks with:

- **Agent Type** — Claude Code, Codex or Goose. Claude Code speaks the Anthropic protocol; Codex the OpenAI Responses API; Goose OpenAI Chat Completions. This choice narrows which providers you can pick next
- **API Provider** — the one from the last chapter
- **Model** — a model that provider actually serves
- **Small Model** — for the agent's own lightweight work (file search, code indexing). Defaults to the main model; point it at something cheaper and faster to save money

> **Changing the agent type restarts the container**, which interrupts every running session. Stop your sessions first.

The model is not a commitment. Use a strong one for hard tasks, a fast one for bulk work, and switch later in the same workspace — neither the prompt nor the skills have to change.

## Prompt: the core of behavior

The system prompt is the single largest lever on behavior. Same model, different prompt, and you have two different agents.

The **Prompt** area takes it from either of two places:

- **Write your own** — straight into the editor
- **Reference the library** — pick a prompt you or the team already maintain. Referenced prompts sync everywhere they're used whenever the library copy changes

Write your own the first time. Once it's settled, move it to the library so others can point at it.

### What a usable prompt has in it

A good system prompt generally has four parts:

1. **The role** — who it is, and where its responsibility ends
2. **The steps** — how a typical task gets handled, in order
3. **The output** — what language, what structure, Markdown or not
4. **The limits** — what it must not do, what it has to confirm, what takes priority

A minimal example:

```text
You are a translation assistant working from Chinese into English.

Steps:
1. Identify the document type first (technical, marketing, legal, ...)
2. For technical documents, leave proper nouns in English rather than translating them
3. Return the translation aligned with the source paragraph by paragraph

Reply in English, keeping the source's paragraph structure and Markdown.

Limits:
- Ask before guessing at a term you can't resolve
- Never add content that isn't in the source
```

That's a starting point. A real one usually runs longer: which tools to use when, how the typical tasks get handled, and what to do when something unusual shows up.

### How to write one

**Concrete before abstract.** "You are an X assistant" does far less work than "your job is to explain why this class of event failed, and decide whether it should be retried automatically" — which sets the scope, the goal and the decision in one sentence.

**Give typical workflows, not an exhaustive list.** Don't try to enumerate every situation. Take the two or three most typical tasks, spell those out completely, and let the agent generalize.

**Write the limits in from the start.** "No destructive operations", "dry-run before changing anything", "ask when unsure" — these belong in the first version, not added after the first accident.

**Iterate against real sessions.** Write a version, run real tasks through it, watch where it stalls or misreads, then revise. A prompt that works usually takes five to ten rounds.

## Skills: reusable capability packages

A skill packages a way of doing one class of thing — a directory with a description file and a few tool scripts. Enabled, it loads at startup and the agent knows the capability is there.

The **Skills** area lists what's available. Tick what you want, save, and it takes effect after the agent restarts.

### When to enable one

- The steps are **fairly fixed** — the standard way to use some API, or handling one kind of file by convention
- It's **only needed in some agents** — a translation agent wants terminology lookup; a code-review agent has no use for it, so there's no reason to load it everywhere
- **Someone already packaged it** — take it rather than teaching the agent from scratch again

If what you need doesn't exist, you can build one and put it in the library. That's a scaling topic — see [Operating at Scale](/guides/7-operate-at-scale/).

## MCP: connecting external tools

MCP is the other route to external tools: connect to a service that runs on its own, and everything it exposes becomes callable.

The **MCP** area takes the connection details (a command or a URL). For deploying and connecting a service, see [Extending the Workspace](/guides/4-extend-workspace/).

## Memory: recall across sessions

Sessions are independent by default — what came out of the last one isn't there in the next. Memory closes that gap.

NAP handles it with a **memory store**: a resource of its own that attaches to one workspace or several. The [Memory Store](/concepts/memory-store/) page has the full design; this section is about using it.

### Where to find it

Two places:

- The **Memory** app on the home screen (`⌘K` outside any workspace) — the account view: every store you have, creating them, editing records, version history
- The **Memory** app inside a workspace — this workspace's view: what's attached, and attaching or detaching

### Stores and workspaces aren't welded together

Create a workspace and a store of the same name is created and attached, so the default looks one-to-one. The relationship is looser than that:

- **A workspace can attach several stores** — a user-level store (language preference and other general things) alongside a workspace-specific one is a common pairing
- **A store can attach to several workspaces** — the same memory shared across workspaces that work together

Migration note: the old one-Markdown-per-workspace memory was moved into the same-named store as its first record.

### Records and the four types

Each memory is a record in the store, and each needs a type:

| Type | Leans toward | Example |
|---|---|---|
| **user** | Account-wide preferences and personality | "Reply in Chinese by default", "code style follows PEP 8" |
| **feedback** | Corrections from the conversation at hand | "Be terser", "Don't mix English into Chinese" |
| **project** | Stable project or task knowledge | "This project runs PostgreSQL, main tables under the `app_user` database", "a DROP TABLE took us down once — confirm before dropping anything" |
| **reference** | A pointer outward | "Read https://internal-wiki/compliance before answering compliance questions" |

Every record is **versioned**, so it's traceable and reversible.

### What doesn't belong in a memory store

- **Anything that changes** — today's to-dos, current environment variables. Write those to files or look them up
- **Secrets** — API keys and passwords go in [credentials](/guides/4-extend-workspace/#credentials-keys-to-external-resources)
- **Very long content** — a whole codebase description, a forty-page spec. The index enters every conversation's context, so length costs you on every turn; long bodies belong in subfiles the agent reads on demand

### How the agent reads and writes it

To the agent a store is a **directory** in its container, at `/mnt/memory/<store-name>/`. It works with ordinary file operations — `cat`, `grep`, `head`, pipes — and needs no special API.

At each store's root, `MEMORY.md` (uppercase) is the **index**. The agent maintains it, and the platform inlines it into the system prompt. So from startup it knows what's attached and what's in each store; for the detail it reads the subfiles by path.

When the agent says it has noted something down for next time, this is what it just did.

### Worth doing once, up front

If your workspace came from an older version, the first memory is usually one block of legacy notes. Tell the agent:

> "This memory was migrated from an old version. Reorganize it along best practice."

It will split it, classify it, and maintain `MEMORY.md` itself. Everything works better afterwards.

## Agent settings and Resources

Both can usually stay at their defaults:

- **Agent settings** — advanced parameters of the core itself (Claude Code writes `.claude/settings.json`; Codex appends to `~/.codex/config.toml`). Open it and the right side documents the fields for the current agent type
- **Resources** — CPU, memory and storage for the container. The defaults cover most work; raise them when the agent handles large files or runs heavy tools

## A rhythm that works

Starting out, go in this order:

1. Pick a model
2. Write a prompt that gets **one typical task right**
3. Run it on real cases a few times, see what's missing, revise the prompt
4. Repeat step 3. Only once the prompt is steady, add skills and MCP
5. Once this one workspace genuinely earns its keep, move the prompt into the library so others can reference it

Resist stacking skills and MCP early. A prompt that's right is worth more than ten skills that are configured.

## Enabling builder mode

[Builder mode](/concepts/builder-mode/) is what lets you say "make the prompt clearer" or "add a 9am schedule" in conversation and have the agent make the change while you approve it, instead of going back to fill in forms. Turn it on when you want it.

**Where**: Settings → **MCP** → the **Platform** card → the **Builder Mode** multi-select.

Two capabilities. Enable either or both; with neither ticked, builder mode is off:

| Capability | Scope | What the agent can change |
| --- | --- | --- |
| **This workspace** | This workspace only | The system prompt source, enabling and disabling skills, creating and editing commands and schedules, the model / provider / agent type, the name, visibility |
| **Account-wide** | Resources across your account | Credentials, providers, the prompt library, shares |

With either one on, the agent also gains a set of **read-only** capabilities to base its proposals on:

- Read the prompt library, skills and providers visible to your account
- Read this workspace's configuration (prompt source, model, enabled skills, and so on)
- Read this workspace's schedules and commands
- Pull the full conversation of past sessions for review (downloading JSONL on demand)

The checkboxes govern **what can be written**. The read layer is shared, so whichever you enable, the agent can see the current state before it proposes anything.

Save, and from your next message the agent can see the tools. There are no commands to memorize — **describe what you want changed**:

> "Read the last 5 chats, work out where my system prompt is tripping you up, and propose fixes."

Changes come back as cards in the conversation; you read them and click Approve or Reject. The [Builder Mode](/concepts/builder-mode/) page has the full picture.

## Next

- Connecting the agent to more external capability — MCP services, custom tabs, custom commands → [Extending the Workspace](/guides/4-extend-workspace/)
- Having it triggered by something other than you typing → [Triggering Agents](/guides/5-trigger-agents/)
