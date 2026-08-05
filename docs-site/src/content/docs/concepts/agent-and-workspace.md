---
title: Workspace, Agent, and Session
description: The three terms you will meet most often, and where each one stops
---

These three come up on every page. Settling their boundaries now makes every later feature easier to place.

## A workspace is the agent's desk

A workspace is a complete working environment, holding everything an agent needs:

- **Configuration** — which model it uses, which prompt, which skills it loads, which MCP servers it connects to
- **File system** — a persistent working directory the agent reads and writes
- **Terminal** — a container it runs commands in
- **Conversation records** — the history of every session
- **Automation** — schedules, external triggers, custom commands

**One workspace, one agent.** Creating an agent is really creating a workspace.

Why not just say "agent"? Because the word on its own gets confused with the agent core (Claude Code / Codex / Goose). "Workspace" puts the weight on the **environment**: the configuration, the state and the resources all sit inside it. It isn't a free-floating intelligence.

## An agent is a workspace in its running form

A workspace starts on its own once created. The instance that comes up is the agent: it has loaded the workspace's configuration and is waiting for work.

Open a workspace in the web UI and the conversation box, the file browser and the terminal are all views onto that one running agent.

A workspace can be **stopped and restarted**. Stopped, the configuration and files are still there — there just isn't a process. Restarted, the agent picks up where it was.

## A session is one conversation or one task

A session is the smallest unit of work: one stretch of conversation with its own context. A single workspace can run several at once:

- Session A handles a code review
- Session B does a translation
- Session C digs into a CI failure

They stay out of each other's context. But **they share the workspace's file system and terminal** — a file A downloads is one B can see.

Every trigger produces a session too: a new conversation in the web UI, a Schedule firing, a Slack message arriving. Each adds one more session to the workspace.

## Why the three layers are split this way

Splitting configuration from running is what makes configuration something you can snapshot, copy and version — which is exactly what a Template in the Library is. Splitting running from conversation is what lets one agent handle several independent tasks at once instead of restarting between them.

With the hierarchy sorted, later features land where you expect: changing a prompt is changing the workspace's configuration, debugging one conversation is reading one session's history, and a Schedule firing is just a new session opening.
