---
title: 6. Composing Agents
description: Let one Agent call another to compose complex capabilities
---

By now you can tune an Agent well, and you can trigger it from a variety of channels. This chapter covers a new dimension—**letting Agents call each other**.

Why do this? Because many tasks are inherently multi-role: after writing code, have another Agent review it; after finishing a translation, have another Agent run QA; after triaging a request, hand it off to the real expert. Splitting these roles into separate Agents, each tuned well, and then composing them to work together is often more stable and more maintainable than training one "knows everything" Agent.

## How it works

Neutree Agent Platform (NAP) lets one Agent **call another Agent like a tool** within a conversation. To make a Workspace callable by others, you need to do two things:

1. Give it a **recognizable Slug**
2. Set its **Visibility**

Open **Workspace Settings** and find the Slug and Visibility fields.

### Slug

The Slug is the Workspace's unique identifier, by which other Agents reference it. For example `qa-checker`, `code-reviewer`, `translator`.

- Only lowercase letters, digits, and hyphens are allowed
- Leave it empty to make the Workspace non-callable by other Agents

### Visibility

| Visibility | Who can call it | Call syntax |
|---|---|---|
| **Private** | Not callable | — |
| **User** | Your own other Agents | `@agent/slug` |
| **Public** | Any user's Agents on the platform | `@agent/username/slug` |

## Calling another Agent in a conversation

After setting the Slug and Visibility, write this in the calling Agent's conversation:

```
After writing this plan, have @agent/reviewer review it for me
```

The calling Agent automatically handles the cross-Workspace communication: it passes the context over, waits for the callee to return a result, then integrates it back into the current conversation and continues working.

You can also use **background mode**—send it off without waiting, letting the callee work at its own pace in its own Workspace, and report back via a notification or by writing a file when done. This suits longer-running tasks.

When you need to pass **large amounts of material** or **generated artifacts** between Agents, don't stuff them into the prompt—use [AFS (cross-Agent file sharing)](/concepts/afs/): write the file to a shared directory, grant access to the collaborator, and they can read it directly at the same path inside their own container.

## A few typical collaboration patterns

Different business scenarios call for different collaboration structures. Here are the three most common ones:

### 1. Triage → Expert

The entry point is a **triage Agent** with a very short Prompt whose sole job is to judge "which category is this problem" and then hand it off to the corresponding expert Agent.

```
You are a triage assistant. User requests fall into one of three categories:
- Translation-related → hand off to @agent/translator
- Code issues → hand off to @agent/code-helper
- Other → hand off to @agent/general

After deciding, state your judgment in one sentence, then call the corresponding agent.
```

The benefit: each expert Agent can be tuned, swapped to a different model, and maintained independently. Adding a new category just means adding a new expert, without changing the others.

### 2. Pipeline

A task has fixed multiple steps: A finishes and hands off to B, B finishes and hands off to C. Each step is an Agent.

Example: a translation pipeline —
- `translator` —does the translation
- `qa-checker` —checks translation quality
- `formatter` —outputs in the target format

After `translator` finishes, it calls `qa-checker`; once QA passes, it calls `formatter`. Any step that goes wrong can be pinpointed to a specific Agent.

### 3. Planner + Worker

A **planner** Agent breaks down the task and plans the steps, then hands each step to a corresponding **worker** Agent, and finally aggregates the results.

This suits scenarios where the task structure isn't known in advance—the planner only knows how many steps to break it into and whom to call after reading the requirements.

## Teamwork: task-level multi-Agent collaboration

The above describes **long-lived, fixed** collaboration relationships—A has a stable Slug, B is visible long-term and callable at any time, and the directory stays mounted. But a lot of collaboration is actually **one-off**:

> "This time I want to pull in two Agents to help me do a piece of research, then disband once it's done."
>
> "I want to bring my private Agent in for a single use, without permanently promoting it to user/public visibility."

For this scenario, NAP provides **Teamwork** (in preview). Find the Teamwork entry under "Apps" and create a team task:

1. **Designate a coordinator Agent**—it's the main Agent, and all sub-agent calls are initiated by it
2. **Add members**—the candidate list includes all public / user visible Agents, **plus your own private Agents** (if one doesn't have a slug yet, you can set it up right here). A private Agent added to a task is only visible within that task and doesn't affect other scenarios
3. **Start the conversation**—the platform automatically creates a shared directory for this task and mounts it for all members; mounting/unmounting happens automatically as members join/leave; the directory is reclaimed automatically when the task ends

The task detail page has a **collaboration timeline**: one line per member's session, each `call_agent` lands a point on the line, showing the main→sub sub-message, the sub→main result, and whether the call is synchronous or asynchronous. Very intuitive when debugging multi-Agent collaboration.

**When to use Teamwork vs. when to keep using plain `@agent`:**

- Long-lived, fixed collaboration → configure Slug + Visibility, the approach in the first half of this chapter
- **One-off tasks, needing to temporarily pull in a private Agent, needing shared files**—use Teamwork

For the full design motivation and how it works, see the [Teamwork concepts page](/concepts/teamwork/).

## Some practical experience

**Keep each Agent's responsibility narrow.** A "knows everything" Agent is hard to tune. One Agent doing one thing well beats five Agents each doing half a thing.

**Keep Slug names stable.** Once other Agents reference your Slug, renaming it breaks those references. Think it through before settling on a name.

**Try Private/User first, then go Public.** Public exposes the Agent to the whole platform—any user's Agent can call yours. Unless you really intend to build a public capability, it's better to be conservative.

**Don't nest call relationships too deep.** A calling B calling C calling D is allowed, but each extra layer doubles the latency and makes troubleshooting harder. Three layers or fewer is a manageable range.

## Next

By now you've covered both the Agent's "capability surface" and its "collaboration surface." The final chapter covers how to **reuse, share, and scale** these capabilities → [Guide 7: Operating at Scale](/guides/7-operate-at-scale/).
