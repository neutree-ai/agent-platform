---
title: Workspace, Agent, and Session
description: The three most-used terms in Neutree Agent Platform, and what each one is
---

You'll encounter these three terms over and over, so clarifying their boundaries up front will make every later feature easier to understand.

## A Workspace is the Agent's desk

A Workspace is a complete "working environment" that contains everything an Agent needs to work:

- **Configuration** — which model it uses, which prompt, which skills it loads, which MCP servers it connects to
- **File system** — a persistent working directory where the Agent reads and writes files
- **Terminal** — a container environment that can execute commands, where the Agent runs system commands
- **Conversation records** — the history of all sessions
- **Automation rules** — scheduled tasks, external triggers, custom commands

**One Workspace corresponds to one Agent.** When we say "create an Agent," we're essentially creating a Workspace.

Why not just call it an "Agent"? Because the word Agent, said on its own, is easily confused with the "Agent engine" (Claude Code / Codex). Workspace emphasizes the **environment** — the configuration, state, and resources are all inside it; it isn't a free-floating AI.

## An Agent is a Workspace in its running form

A Workspace starts automatically after it's created. The running instance that comes up is the Agent; it has loaded all of the Workspace's configuration and is waiting for tasks.

When you open a Workspace in the Web UI and see the "conversation box, file browser, terminal" — these are all different facets of that running Agent.

A Workspace can be **stopped and restarted**. After stopping, the configuration and files are still there; there just isn't a process running. After restarting, the Agent resumes work.

## A Session is one conversation or task

A Session is the smallest unit of Agent work — one stretch of conversation with context. A single Workspace can run multiple Sessions at the same time:

- Session A handles code review
- Session B does translation
- Session C debugs a CI failure

They are independent of each other and don't pollute each other's context. But **they share the same Workspace's file system and terminal** — a file A downloaded is also visible to B.

Every triggering mechanism also produces a Session: starting a new conversation in the Web UI, a Schedule firing on time, a Slack message arriving — each results in one more Session in the Workspace.

## Why these three layers are separated this way

Separating "configuration" from "running" means the configuration can be snapshotted, copied, and versioned (this is exactly the Template in the Library). Separating "running" from "conversation" means the same Agent can handle multiple independent tasks at once, without restarting each time.

Once you've sorted out this hierarchy, every later feature falls into place: changing a prompt is changing the Workspace's configuration, debugging one specific conversation is looking at a particular Session's history, and a Schedule firing on time is really just creating a new Session.
