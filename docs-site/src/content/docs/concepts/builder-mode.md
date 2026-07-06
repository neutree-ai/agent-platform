---
title: "Builder Mode: Let the Agent Configure Its Own Workspace"
description: Let the Agent modify its own Workspace configuration within the conversation
---

A Workspace's configuration—system prompt, enabled skills, schedules, model choice—can all be changed via UI forms. But the more you use it, the more you'll notice that some adjustments are simpler to just say in conversation:

> "In the last few chats you've been missing the point. See if something's wrong with the prompt, and make it clearer."
>
> "Turn the set of questions I just asked into a `/review` command."
>
> "Run this for me every morning at 9 a.m."

**Builder Mode** lets the Agent understand this kind of request in conversation—it sends the change to you as a proposal, you click "Approve," and the change takes effect.

## Core Value

- **More flexible than forms, and it harnesses the Agent's intelligence**—you only describe the intent; how to make the change is designed by the Agent. It knows what the current prompt looks like and how to coordinate multiple configurations to achieve the goal—more thorough than tuning by hand
- **Changes can come from past conversations**—the Agent can pull up recent chat history and analyze it, proposing "the last few times you got stuck on this part of the prompt; I suggest changing it to this"
- **You approve every change**—the Agent won't make changes behind your back. Every proposal is an approval card in the chat, where you can preview the change, and only after you click "Approve" or "Reject" does it take effect

## When to Use

- You want to optimize the prompt but don't know where to start—have the Agent look at a few recent conversations and then propose
- The same kind of question comes up repeatedly—have the Agent save it as a command itself
- Adding/adjusting a schedule—just describe the requirement clearly; no need to learn cron expressions
- Switching the model / provider / enabling a skill—just say "switch to xxx"
- You're unsure about a parameter—for example, you say "use China time zone," and the Agent knows to map it to `Asia/Shanghai`, instead of stalling you with an option tab you don't understand

## When Not To Use

- **Cross-Workspace editing**—for safety, the default **This workspace** capability only changes the current Workspace's own configuration; account-wide resources require enabling the separate **Account-wide** capability (see [Enabling Builder Mode](/guides/3-agent-behavior/#enabling-builder-mode))
- **Fine-grained field tweaks**—for example, changing a single word in the prompt; the UI editor may be handier

## The Safety Guarantees of the Approval Model

In Builder Mode, every change the Agent makes goes through the two steps of "propose → user approves → apply." This is more than a UX "just confirm"—there's a structural safeguard behind it.

**What you approve = what you apply**—when a proposal is generated, the platform persists the complete source data of this change to the backend and **returns an ID**. After approval, when the Agent calls the `apply` tool, it passes this **ID, not the raw payload**. After the backend receives the ID, it:

1. Uses the ID to find the original approval data
2. Validates that it indeed conforms to the schema of the corresponding resource (schedule / prompt / skill, etc.)
3. Only writes it after it passes

This means:

- The Agent has no way to "secretly" swap in a payload you didn't see at apply time—all it can pass is an ID
- The platform performs another layer of schema validation—for example, even if a cron expression passed your visual inspection, a schema-invalid one will be rejected by the backend

In the UI, each approval card **breaks the source data into fields** for display (rather than dumping raw JSON), making review less tedious. Click to open and you see the fields, their meanings, and the changes; reject if you don't like it, click approve if you do.

## The Mechanism for Reading Historical Sessions

A very useful scenario for Builder Mode is having the Agent "look at a few recent conversations and analyze where my prompt needs changing." To do this, the Agent must be able to read the contents of historical sessions.

But **directly stuffing session content into the tool result isn't feasible**—a session can be very long, and pouring tens of thousands of lines of tool calls into context at once wastes tokens and still can't read it all.

So the builder tool's approach is: return an **export URL**, which the Agent downloads to a local file with `curl` / `bash`, then analyzes using file tools (grep, reading fragments on demand). This way:

- The main conversation's context only bears the "analysis process," not the session's raw content
- The Agent can use the file-operation semantics it's most familiar with, reading the relevant parts on demand

This is why Builder Mode is more efficient than the early standalone "prompt optimizer" feature—the latter required you to manually select a few sessions and manually declare the optimization goal, and the Agent could only analyze based on the few sessions you provided; Builder Mode lets the Agent list sessions itself in conversation, download on demand, set its own optimization approach, and finally land the change through the same approval mechanism.

> Note for existing users: the original **prompt optimizer** experimental feature has been retired. Builder Mode is its better version—no need to leave the familiar conversation entry; session selection, topic declaration, and landing the change all happen in the same conversation.

Having the Agent review historical sessions and improve its own configuration is itself part of [Optimization](/concepts/optimize/)—Builder Mode is the entry point for landing and approving it; the full picture of optimization (autonomous tuning, and later model replacement) is laid out in that chapter.

---

For specific setup steps and the capability list, see [Enabling Builder Mode](/guides/3-agent-behavior/#enabling-builder-mode).
