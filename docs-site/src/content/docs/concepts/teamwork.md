---
title: "Teamwork: Multiple Agents Collaborating on a Single Task"
description: Task-scoped multi-Agent collaboration, with automatic management of visibility, shared directories, and a collaboration timeline
---

> Teamwork is currently in preview. The core mechanics are stable, but the final shape may change. We welcome your feedback as you use it.

Neutree Agent Platform (NAP) has always supported multi-Agent collaboration: in any Workspace you can call another Agent with `@agent/slug`, and to pass files you can create a shared directory with [AFS](/concepts/afs/). But both of these are **Workspace-level** configurations—an Agent is either visible to others or not, and a shared directory is either mounted or not.

Yet much collaboration is actually **task-scoped**:

> "Just this once, I want my private Agent to temporarily help me do some research, then go back to being invisible when it's done."
>
> "Several Agents write into one directory together, then archive it when done; next task, swap in a different set of members and a different directory."

**Teamwork** is built for exactly this—you create a team task in "Apps", pull members in, and the platform automatically manages visibility, the shared directory, and the collaboration timeline. When the task ends, everything is reclaimed.

## The Value of Multi-Agent Collaboration

To understand Teamwork's design, you first need to understand what problem multi-Agent collaboration actually solves.

Our view: **the essence of multi-Agent is managing context well so tasks run more reliably**—not drawing a bunch of colorful CEO/CTO personas on a canvas. That style of dragging Agents into nodes and connecting them with lines doesn't genuinely help task completion.

A single Agent's context usually crams in:

- The system prompt, loaded skills, and available tools (**the static part**—representing responsibilities and knowledge)
- User messages, model replies, and tool-call requests and results (**the dynamic part**—the content accumulated over this conversation)

This hits two bottlenecks:

1. **The static part bloats**—if one Agent must build slide decks, edit Excel, and query databases, every added capability lengthens the system prompt and skills. But any single conversation only uses a small fraction of it; the rest is wasted.
2. **The dynamic part gets dirty**—an Agent often has to explore before finishing a task (list directories, read files, trial and error). Once it finds the answer, that process content is "non-essential," but it has already taken up context space as fragments, distracting subsequent reasoning, and it's hard to remove.

**How sub-agents mitigate both:**

- **Separation of responsibilities**—the main Agent only handles decomposition and dispatch. The slide-building capability lives in one sub-agent, Excel in another. Whoever the current task needs gets woken up; capabilities that aren't needed never enter the main Agent's context.
- **Isolation of the exploration process**—a sub-agent explores, experiments, and reads files in its own session, and those tokens stay in the sub-session. The main Agent only receives the sub-agent's **final result** through a tool call (a distilled summary). Once the sub-session ends, the exploration process is naturally discarded and won't pollute the main context.

This is the core mechanism Teamwork aims to leverage. All the collaboration UI, visibility configuration, and shared-directory management exist to make this smoother from both the user's and the Agent's perspective.

## The Existing Multi-Agent Foundation

Teamwork isn't built from scratch. It rests on two existing capabilities:

### Agent-calling tools: `call_agent` / `get_agent_result`

The main Agent calls another Agent through these two built-in tools:

- `call_agent`—initiates a call. The parameters are the target Agent's slug and the task description to hand off (this description becomes the first user message of the sub-session—the main Agent distills the part of its context relevant to this call as the parameter). It supports both **synchronous** and **asynchronous** modes: synchronous waits for the sub-agent to finish; asynchronous lets you proactively push a long task into the background. Either way, the tool returns the sub-session's ID.
- `get_agent_result`—queries the result by sub-session ID. It can poll asynchronous tasks and also revisit past collaboration.

`call_agent` also supports **starting a new session** or **continuing a previous one**—two Agents can have multi-turn, multi-threaded conversations, much like people collaborating.

### File-level context: AFS shared directories

Conversations can pass text, but not things like slide-deck binaries, PDFs, or hundreds of lines of CSV. By default, two Agents' file systems are isolated—files a sub-agent writes in its own container can't be read by the main Agent.

[AFS](/concepts/afs/) solves this: you can create a shared directory and mount it for multiple Agents; you control whether access is read-only or read-write, and you can revoke it anytime. Agents can also initiate sharing themselves through MCP tools.

Teamwork uses this same underlying layer—it just automates "create directory, mount, reclaim."

## Teamwork's Three Enhancements

Teamwork doesn't replace the two capabilities above; it adds a layer of "**task**" semantics on top of them. On the home screen, press `⌘K` and open **Teamwork** (marked as preview), create a team task, set a **coordinator** Agent, then add members. From that moment, the following three things take effect automatically.

### 1. Task-scoped Agent visibility

Normally, a Workspace's [Visibility](/guides/6-compose-agents/#visibility) has three tiers: Private / User / Public. This is a Workspace-level standing configuration—an Agent is either visible to collaborators or not.

But if what you want is "just this once, have a private Agent do something for me, then keep it invisible afterward," the standing configuration is too heavyweight—you'd have to keep toggling back and forth.

When adding members to a team task, the candidate list includes:

- All Public-visible Agents
- All User-level-visible Agents (your own)
- Your own **Private** Agents—if one doesn't have a slug configured yet, you can configure one right here when adding it

After adding a Private Agent to a task, it is **visible only within this task** and doesn't affect other scenarios. The task takes **priority over** the Workspace's global visibility configuration. So you don't have to expose an Agent at the user/public level just for a single task.

### 2. Automatically managed shared directory

Each team task automatically creates a shared directory when created (named after the task ID, like `team-<uid>`), and the platform mounts it for all current members.

- Member joins → automatically mounted
- Member leaves → automatically unmounted
- Task ends → shared directory reclaimed

Members no longer need the two steps of "create directory → grant access"—as long as they're in the task, there's an interconnected working directory available. When you need finer-grained control (for instance, a separate temporary directory between just two Agents), you can still do it manually via the AFS API; the automatic management simply covers the vast majority of cases.

### 3. Collaboration timeline

As noted earlier, **a complex multi-Agent dispatch canvas doesn't genuinely help the end result**—but there is one observability view that is genuinely useful: seeing exactly what context Agents exchange with each other.

A team task's detail page provides a **collaboration timeline**:

- Each member's session is one timeline (the coordinator at the top, sub-agents below in order)
- Each `call_agent` drops a point on the timeline, indicating: the **sub-message sent main→sub**, the **result returned sub→main**, and whether the call is **synchronous or asynchronous**

You can collapse it if you don't like it. But when debugging multi-Agent collaboration, this is the most direct tool—you can immediately see exactly what the main Agent passed to the sub-agent and what the sub-agent summarized back, without scrolling through the conversation record line by line.

## Typical Scenarios

### Split research + main Agent merges

The main Agent splits the task across two sub-agents: one researches competitor ACME, one researches competitor Beta, and each writes its report to the shared directory. Once done, the main Agent reads both files and merges them into one overall report.

The full flow is visible in the collaboration timeline: two `call_agent` calls issued in parallel → the two sub-agents each write markdown to `team-<uid>/ACME.md` and `team-<uid>/Beta.md` → the main Agent reads both and writes out `report.md`.

### Multiple parallel sessions of the same Agent

A team task doesn't have to contain multiple kinds of Agent. **The same Agent** can also open several parallel sessions, each doing one thing—as noted, the essence of multi-Agent is managing context well, and a single Agent's multiple sessions benefit from this just as much.

For example, have a code-review Agent open three sessions to inspect the same piece of code in parallel—one checks naming conventions, one checks SQL safety, one checks frontend error handling. Each session loads only the context for that one direction, with a much higher hit rate than "one session checking all aspects."

## When to Use and When Not To

**Use Teamwork:**

- This task needs **temporary members** (including your private Agents), and you'll disband when done
- Members need to **share files**, but you don't want to manage AFS directories manually
- You want to observe the context exchange between Agents and debug a multi-Agent flow

**Keep using plain `@agent` calls:**

- A long-standing fixed collaboration relationship (e.g., a reviewer Agent that's constantly called by various dev Agents)—configuring Visibility and Slug is enough; no need to spin up a task each time
- Simple one-off calls with no file exchange

## Next

- Want to know exactly how Agents call each other and how to configure Visibility → [Composing Agents](/guides/6-compose-agents/)
- Want to understand the underpinnings of cross-Agent file sharing → [AFS: Cross-Agent File Sharing](/concepts/afs/)
