---
title: 6. Composing Agents
description: One agent calling another, so capability composes instead of piling up
---

You can shape an agent well, and you can start it from several directions. This chapter adds a dimension: **agents calling each other**.

Why bother? Because plenty of work is multi-role by nature. Code gets written, then reviewed. A translation gets done, then checked. A request gets triaged, then handed to whoever actually knows. Splitting those roles into separate agents, tuning each, and composing them usually holds up better — and is easier to maintain — than one agent that supposedly knows everything.

## How it works

NAP lets one agent **call another like a tool**, inside a conversation. Making a workspace callable takes two things:

1. A recognizable **slug**
2. A **visibility** setting

Both are in the workspace's **Settings** app, under **General**.

### Slug

The slug is the workspace's identifier, and how other agents name it: `qa-checker`, `code-reviewer`, `translator`.

- Lowercase letters, digits and hyphens
- Leave it empty and no other agent can call it

### Visibility

| Visibility | Who can call it | How they write it |
|---|---|---|
| **Private** | Nobody | — |
| **User** | Your own other agents | `@agent/slug` |
| **Public** | Any agent on the instance | `@agent/username/slug` |

## Calling another agent

With slug and visibility set, write it into the conversation:

```
Once this plan is written, have @agent/reviewer look it over
```

The calling agent handles the crossing itself: it passes the context over, waits for the result, folds it back into the conversation and carries on.

There's also **background mode** — send it off without waiting, let the callee work at its own pace and report back with a notification or a file. That's the one for long jobs.

When there's **real material** to hand over, or an artifact to return, don't put it in the prompt. Use [AFS](/concepts/afs/): write the file into a shared directory, grant the collaborator access, and they read it at the same path in their own container.

## Three patterns that recur

### 1. Triage → expert

The entry point is a **triage agent** with a very short prompt whose only job is deciding what kind of problem this is, then handing it over.

```
You are a triage assistant. Requests fall into three kinds:
- Translation → hand to @agent/translator
- Code → hand to @agent/code-helper
- Anything else → hand to @agent/general

Say which one this is in a sentence, then call that agent.
```

What it buys you: each expert is tuned, modelled and maintained on its own, and adding a category means adding an expert rather than editing the others.

### 2. Pipeline

Fixed steps, in order. A finishes and hands to B, B to C, one agent per step.

A translation pipeline, say:

- `translator` — does the translation
- `qa-checker` — checks it
- `formatter` — emits the target format

`translator` calls `qa-checker` when it's done; QA passes and it calls `formatter`. When something comes out wrong, it belongs to a specific agent.

### 3. Planner + workers

A **planner** reads the requirement, decides the steps, hands each to a **worker**, then merges what comes back.

This is the one for work whose shape isn't known in advance — the planner only finds out how many steps there are, and who to call, after it has read what's being asked.

## Teamwork: collaboration scoped to a task

Everything above is **standing** collaboration: a stable slug, long-term visibility, a directory that stays mounted. Plenty of collaboration is **one-off**:

> "For this piece of research I want two agents helping, and then it's over."
>
> "I want my private agent in for one task, without promoting it to user or public for good."

**Teamwork** (in preview) is for that. From the home screen, `⌘K` → **Teamwork**, create a team task:

1. **Set a coordinator** — the main agent; every sub-agent call comes from it
2. **Add members** — candidates include every public and user-visible agent, **plus your own private ones** (and you can give one a slug right there). A private agent added to a task is visible inside that task only
3. **Start** — the platform creates a shared directory for the task and mounts it for every member, mounting and unmounting as people join and leave, and reclaiming it when the task ends

The task's detail page has a **collaboration timeline**: one track per member session, a point for each `call_agent` showing what went down, what came back, and whether the call was synchronous. When a multi-agent flow misbehaves, this is where you look.

**Which one to use:**

- Standing collaboration → slug plus visibility, as in the first half of this chapter
- **One-off work, a private agent borrowed for a task, files to share** → Teamwork

The design and the reasoning are on the [Teamwork](/concepts/teamwork/) page.

## Things worth knowing

**Keep each agent's job narrow.** An agent that does everything is hard to tune. One agent doing one thing well beats five doing half a thing each.

**Keep slugs stable.** Once others reference a slug, renaming it breaks them. Choose it as if it's permanent.

**Start Private or User; go Public deliberately.** Public means any agent on the instance can call yours. Unless you meant to publish a capability, stay conservative.

**Don't nest too deep.** A calling B calling C calling D works, but every layer adds latency and makes a failure harder to place. Three is a sane ceiling.

## Next

Capability and collaboration are both covered. The last chapter is about making all of it **reusable, shared, and organized** → [Operating at Scale](/guides/7-operate-at-scale/).
