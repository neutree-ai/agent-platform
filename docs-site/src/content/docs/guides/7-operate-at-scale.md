---
title: 7. Operating at Scale
description: Library, tags, shared sessions and team scope — turning one person's tuning into something the team runs on
---

The first six chapters were about one agent: configuring it, shaping it, triggering it, composing it. Once that craft is done, a different set of problems shows up:

- The prompt you got right — how does anyone else get it?
- Five agents on the team — how do their configurations stay in step?
- An agent went wrong — how do you hand that session to a colleague?
- A hundred workspaces in the list — how do you find the one you want?

This chapter is everything in NAP about reuse, sharing and keeping order.

## The Library: prompts, skills, templates

The **Library** app (`⌘K` → **Library**) holds three kinds of thing, each solving one reuse problem.

### Prompts

Put a system prompt you keep reusing into the Library and other workspaces can **reference** it. Once referenced:

- Update the library copy and everything referencing it **follows automatically**
- A workspace that needs to differ can override, at which point it stops following (and can start again whenever)

Worth extracting when:

- **Several workspaces need the same behavior** — the classic case being one class of agent standardized across a team
- **The prompt is still moving** — you don't want to hand-copy every revision into five places
- **You want versions** — library prompts keep them, so you can compare and go back

If exactly one workspace uses it, leave it where it is. Extract it when a second consumer actually exists.

### Skills

Skills live in the Library too, on the same mechanism. [Defining Agent Behavior](/guides/3-agent-behavior/#skills-reusable-capability-packages) covered **enabling** one; this is **creating** one.

In the **Library** app, switch to **Skills** and create. Two ways in:

- **Upload an archive** — `SKILL.md` and any tool scripts, zipped
- **Import from Git** — a repository and a path; the platform pulls it, and re-syncs when the repository moves

The layout follows a convention:

```
my-skill/
├── SKILL.md       # what this skill does and what it provides
└── scripts/       # tool scripts
    └── ...
```

`SKILL.md` is what the agent actually reads. Writing a good one is most of writing a good skill.

### Templates

A template is a **snapshot of a whole workspace configuration** — model, prompt, skills, MCP, settings, resources. A workspace created from one starts with all of it.

Worth extracting when:

- **You need similar agents in bulk** — a translation agent for everyone on the team
- **New people need somewhere to start** — create from the template instead of configuring from nothing
- **The configuration is still moving** — bound workspaces upgrade in one click when the template changes

In **Settings** → **General**, click **Save as Template**. You can choose whether to **bind** this workspace to it, which is what makes it follow updates.

### Templates and library prompts together

They don't compete; they're only complete together:

- A **template** carries the agent's whole default shape
- A **library prompt** lets the prompt alone keep moving

The common arrangement: the template's prompt field references a library prompt. The template sets the baseline, the prompt iterates on its own, and every workspace created from the template picks up the new wording.

## Tags: keeping the workspace list navigable

Once there are dozens of workspaces, finding one gets slow. **Tags** are the lightweight answer.

Create and manage them in the **Tags** app (`⌘K` → **Tags**), and assign them per workspace in **Settings** → **General**. The workspace switcher in the top bar filters by tag.

Three axes that work:

- By **purpose** — `production`, `staging`, `experiment`
- By **team** — `frontend`, `backend`, `data`
- By **state** — `active`, `archived`, `review`

Colors are for scanning. Filtering is OR: select several and anything matching any of them shows.

## Shared sessions

Debugging an agent usually means showing someone a session — it went the wrong way at some step and another pair of eyes would help.

Use the share button on a session, in **Chat** or in **Session History**. It generates a public link showing that session in full: messages, tool calls, file operations.

Good for:

- **Asking for help** — hand the bad session to whoever knows this part
- **Showing the work** — walk a stakeholder through an end-to-end run
- **Retrospectives** — file the runs that went unusually well or unusually badly

The link is **public**. Don't share sessions with anything sensitive in them.

## Visibility and team scope

[Composing Agents](/guides/6-compose-agents/#visibility) covered how a workspace's visibility decides **who can call it**. The same field decides **whose list it appears in**:

- **Private** — yours alone
- **User** — yours across your own agents, and in nobody else's list
- **Public** — visible to every user on the instance

Library prompts, skills and templates use the platform's three scopes — **Private**, **Team**, **Public**. Public for what the whole instance should have, Team to keep it to selected teams, Private for personal or still-experimental work.

### The pattern most teams land on

1. **Experiment privately** — tune prompts and try skills in a Private workspace, freely
2. **Extract once it's stable** — the prompt into Public Prompts, the skill into Public Skills
3. **Freeze it into a template** — save the mature configuration as a Public Template the team creates from
4. **Keep iterating** — the Library's automatic sync carries improvements out on its own

That's the path from one person's afternoon to something the team runs on.

## Next

You've come the whole way, from a first agent to a team-level capability.

To go deeper on any one piece, the [Concepts](/concepts/overview/) chapter lays out how the parts fit together.
