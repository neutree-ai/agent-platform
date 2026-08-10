---
title: "Teamwork: Multiple Agents on One Task"
description: Task-scoped collaboration, with visibility, the shared directory and the timeline handled for you
---

> Teamwork is in preview. The mechanics are stable; the final shape may still move. Tell us how it goes.

NAP has always supported several agents working together: call another one with `@agent/slug` from any workspace, and hand files over through an [AFS](/concepts/afs/) shared directory. But both of those are **workspace-level** settings — an agent is either visible to others or it isn't, a directory is either mounted or it isn't.

Plenty of collaboration is **task-shaped** instead:

> "Just for this, I want my private agent to help with some research, and go back to being invisible afterwards."
>
> "Several agents write into one directory, then it gets filed. Next task, different members, different directory."

**Teamwork** is built for exactly that. Create a team task in Apps, pull members in, and the platform handles visibility, the shared directory and the collaboration timeline. When the task ends, it all gets reclaimed.

## What multi-agent is actually for

Teamwork's design follows from a view about what collaboration between agents is good for.

**It's about managing context so tasks land more reliably** — not drawing CEO and CTO personas on a canvas. Dragging agents into nodes and joining them with arrows doesn't make the work come out better.

One agent's context usually holds:

- The system prompt, the loaded skills, the available tools — **the static part**, its responsibilities and knowledge
- User messages, model replies, tool calls and their results — **the dynamic part**, what this conversation has accumulated

Both hit a ceiling:

1. **The static part bloats.** If one agent has to build slide decks, edit spreadsheets and query databases, every added capability lengthens the prompt and the skill list. Any single conversation uses a fraction of it, and pays for all of it.
2. **The dynamic part gets dirty.** Agents explore before they finish: listing directories, reading files, trying things. Once the answer is found, that exploration is dead weight — but it's already taken up space, it distracts the reasoning that follows, and it's hard to get rid of.

Sub-agents ease both:

- **Responsibilities separate** — the main agent decomposes and dispatches. Slide-building lives in one sub-agent, spreadsheets in another. Whatever this task needs wakes up; the rest never touches the main context.
- **Exploration stays contained** — a sub-agent explores in its own session, and those tokens stay there. The main agent gets the **result** back through a tool call, distilled. When the sub-session ends, the exploration goes with it.

That's the mechanism Teamwork is built to exploit. The collaboration UI, the visibility settings and the managed directory all exist to make it smoother from both sides.

## What it builds on

Teamwork isn't from scratch. Two existing capabilities carry it.

### Agent calls: `call_agent` / `get_agent_result`

The main agent calls another through two built-in tools:

- `call_agent` — starts a call, taking the target's slug and the task description to hand over. That description becomes the first user message of the sub-session, so the main agent distills the relevant part of its own context into it. It runs **synchronously** or **asynchronously**: synchronous waits, asynchronous pushes a long job into the background. Either way you get the sub-session's ID back.
- `get_agent_result` — looks up a result by sub-session ID. It polls asynchronous work and it reads back collaboration that already happened.

`call_agent` can also **start a new session or continue an old one**, so two agents can hold a multi-turn conversation across several threads, much as people do.

### File-level context: AFS shared directories

A conversation carries text. It doesn't carry a slide deck, a PDF or a few hundred lines of CSV. And two agents' file systems are isolated by default, so what a sub-agent writes in its own container the main agent can't read.

[AFS](/concepts/afs/) is the answer: create a shared directory, mount it for several agents, set read-only or read-write, revoke whenever. Agents can set this up themselves through MCP tools.

Teamwork sits on the same layer. It just automates create, mount and reclaim.

## What Teamwork adds

Teamwork doesn't replace either of those. It puts a layer of **task** semantics over them. From the home screen, `⌘K` → **Teamwork** (marked preview), create a team task, set a **coordinator** agent, add members. Three things then happen on their own.

### 1. Visibility scoped to the task

Normally a workspace's [Visibility](/guides/6-compose-agents/#visibility) has three tiers — Private, User, Public — and it's a standing setting: an agent is reachable by collaborators or it isn't.

For "just this once, let my private agent help, then go back to invisible", a standing setting is the wrong tool. You'd be flipping it back and forth.

When you add members to a task, the candidates are:

- Every Public agent
- Every User-visible agent of yours
- Your own **Private** agents — and if one has no slug yet, you can give it one right there

A private agent added to a task is **visible inside that task only**, and nowhere else. The task takes **precedence** over the workspace's standing visibility. So a single task never forces you to expose an agent account-wide.

### 2. A shared directory, managed for you

Each team task creates a shared directory when it's created, named after the task (`team-<uid>`), and mounts it for every member.

- A member joins → mounted
- A member leaves → unmounted
- The task ends → reclaimed

Nobody has to create a directory and grant access. Being in the task is enough. For finer control — a private scratch directory between two agents, say — the AFS API is still there; the automatic version just covers the common case.

### 3. The collaboration timeline

As said above, an elaborate dispatch canvas doesn't improve the outcome. But one view genuinely helps: seeing what context the agents actually pass each other.

A team task's detail page has a **timeline**:

- One track per member session, coordinator on top, sub-agents below in order
- Each `call_agent` drops a point on it, showing the **message sent down**, the **result sent back**, and whether the call was synchronous or asynchronous

Collapse it if you'd rather. But when a multi-agent flow is misbehaving, it's the most direct instrument there is — you see what the main agent handed over and what came back, without reading the whole conversation line by line.

## Two shapes that work well

### Split the research, merge in the main agent

The main agent splits the work across two sub-agents: one researches competitor ACME, the other Beta, each writing its report into the shared directory. The main agent then reads both files and merges them.

The timeline shows the whole run: two `call_agent` calls in parallel → the sub-agents write `team-<uid>/ACME.md` and `team-<uid>/Beta.md` → the main agent reads both and writes `report.md`.

### One agent, several parallel sessions

A team task doesn't need several kinds of agent. **The same agent** can open several sessions, each on one thing — the point being context management, which a single agent's sessions benefit from just as much.

A code-review agent, say, opening three sessions on the same diff: one on naming, one on SQL safety, one on frontend error handling. Each loads only the context for its own angle, and hits far more than one session trying to cover everything.

## When to use it, and when not

**Use Teamwork when:**

- The task needs **temporary members** (including private agents) and disbands afterwards
- Members need to **share files** and you'd rather not manage AFS directories by hand
- You want to watch the context move between agents and debug the flow

**Stay with plain `@agent` calls when:**

- The collaboration is standing — a reviewer agent that everyone's dev agents call — where Visibility and a slug are enough, and spinning up a task each time is overhead
- The call is a one-off with no files involved

## Next

- How agents call each other, and how Visibility is configured → [Composing Agents](/guides/6-compose-agents/)
- What's underneath cross-agent file sharing → [AFS: Cross-Agent file sharing](/concepts/afs/)
