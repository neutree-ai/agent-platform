---
title: "Builder Mode: Let the Agent Configure Its Own Workspace"
description: Changing a workspace's configuration from inside the conversation, with your approval on every change
---

A workspace's configuration — system prompt, enabled skills, schedules, model choice — is all editable through UI forms. The longer you use it, though, the more some changes are easier to just say out loud:

> "You've been missing the point the last few times. See what's wrong with the prompt and make it clearer."
>
> "Turn the questions I just asked into a `/review` command."
>
> "Run this for me at 9 every morning."

**Builder mode** is the agent understanding that kind of request. It sends the change back as a proposal, you click Approve, and the change takes effect.

## What it buys you

- **More reach than a form** — you describe the intent; the agent works out the change. It knows what the prompt currently says and which settings have to move together to get where you asked, which is more than most hand-edits account for
- **Changes can come out of past conversations** — the agent can pull up recent history and read it, then come back with "you got stuck on this stretch of the prompt three times; here's a rewrite"
- **Nothing lands without your approval** — no change happens behind your back. Every proposal is a card in the conversation with the change laid out; it applies only after you click Approve

## When to reach for it

- The prompt needs work and you don't know where to start — have the agent read a few recent sessions and propose
- The same question keeps coming up — have the agent save it as a command
- Adding or shifting a schedule — describe when, and skip learning cron
- Switching model or Provider, enabling a skill — say "switch to xxx"
- You're unsure what a setting wants — say "use China time" and the agent maps it to `Asia/Shanghai`, instead of parking you on a form field you'd have to go look up

## When not to

- **Editing across workspaces** — the default **This workspace** capability only changes the workspace you're in. Account-wide resources need the separate **Account-wide** capability turned on (see [Enabling Builder Mode](/guides/3-agent-behavior/#enabling-builder-mode))
- **Small precise edits** — changing one word in the prompt is faster in the editor

## What the approval model actually guarantees

Every change goes through propose → approve → apply. That's more than a confirmation dialog; there's a structural guarantee under it.

**What you approve is what gets applied.** When a proposal is generated, the platform persists the complete change to the backend and **returns an ID**. On approval, the agent calls the `apply` tool with **that ID, not the payload**. The backend then:

1. Looks up the original approved data by ID
2. Validates it against the schema for that resource (schedule / prompt / skill, and so on)
3. Writes it only if it passes

Which means:

- The agent has no way to swap in something you never saw at apply time. An ID is all it can pass
- The platform validates once more on its own account — a cron expression that looked fine to you but isn't valid gets rejected here

In the UI, each approval card **breaks the change into fields** rather than dumping raw JSON, so reviewing one isn't a chore. Open it, read the fields and what they change, then approve or reject.

## How the agent reads past sessions

One of builder mode's best uses is "read a few recent conversations and tell me what to fix in my prompt." That means the agent has to get at session content.

**Returning the content in the tool result doesn't work.** A session can run very long, and pouring tens of thousands of lines of tool calls into context burns tokens without ever fitting.

So the builder tool returns an **export URL** instead. The agent downloads it to a file with `curl`, then works on it with file tools — grep, and reading the parts that matter. Two things follow:

- The main conversation carries the analysis, not the raw transcript
- The agent uses the file semantics it already knows, and reads on demand

This is why builder mode beats the standalone prompt optimizer that came before it. That one made you pick the sessions by hand and state the goal by hand, and it could only work from what you handed over. Builder mode lets the agent list sessions itself, download what it wants, decide its own angle, and land the result through the same approval gate.

> For existing users: the **prompt optimizer** experiment has been retired. Builder mode is the better version of it — no separate screen to go to; picking sessions, saying what you're after, and landing the change all happen in the conversation you were already in.

Having the agent review its own history and improve its own configuration is one half of [Optimization](/concepts/optimize/) — builder mode is where those changes land and get approved. The full picture, including model replacement, is in that chapter.

---

For the setup steps and the capability list, see [Enabling Builder Mode](/guides/3-agent-behavior/#enabling-builder-mode).
