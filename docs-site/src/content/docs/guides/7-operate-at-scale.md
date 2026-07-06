---
title: 7. Operating at Scale
description: Library, tags, shared sessions, team collaboration—make what one person tuned usable by the whole team
---

The previous six chapters were all about a single Agent—how to configure it, tune it, trigger it, make it collaborate. Once that craftsmanship is done, new problems emerge:

- The Prompt you tuned—how do you let others use it too?
- The 5 Agents on your team—how do you keep their configurations consistent?
- An Agent went wrong—how do you send this session to a colleague to look at?
- 100 Workspaces piled up in your list—how do you find the one you want?

This chapter covers everything in Neutree Agent Platform (NAP) related to "reuse, sharing, and organization."

## The Library trio: Prompts, Skills, Templates

The **Library** app (`⌘K` → **Library**) holds three kinds of things, each solving one reuse problem.

### Prompts

Store a system Prompt you use repeatedly in the Library. Other Workspaces can **reference** this Prompt, and once a reference is established:

- When the Prompt in the Library is updated, all referencing parties **sync automatically**
- A Workspace that wants to deviate from the baseline can "override," after which it no longer follows updates (it can resume following at any time)

When to extract a Prompt into the Library:

- **Multiple Workspaces use the same behavior** —the classic case is standardizing a class of Agents across a team
- **The same Prompt is being iterated** —you don't want to manually sync to 5 places every time you change it
- **You want version management** —Library Prompts support multiple versions, making it easy to trace back and compare

If only one Workspace uses it, there's no need to extract it. Wait until there's actually a second consumer.

### Skills

Skills are also stored in the Library, with a similar mechanism. [Defining Agent Behavior](/guides/3-agent-behavior/#skills-reusable-capability-packages) covered how to **enable** a skill in a Workspace. Here we cover how to **create** one:

In the **Library** app, switch to **Skills** and create one. You can choose two methods:

- **Upload an archive** —package `SKILL.md` together with any tool scripts into a zip and upload it
- **Import from a Git repository** —specify a repository address and path, and the platform pulls it down. You can re-sync after the repository is updated

A Skill's content structure follows a convention:

```
my-skill/
├── SKILL.md       # describes what this skill does and which commands it provides
└── scripts/       # tool scripts
    └── ...
```

`SKILL.md` is what the Agent actually reads—it tells the Agent what capabilities this skill provides and how to use them. Writing a good `SKILL.md` is the core of writing a good skill.

### Templates

A Template is a **complete snapshot of a Workspace configuration**—model, Prompt, Skills, MCP, settings, and resources all packaged together. A Workspace created from a Template directly owns this entire set of configuration.

When to extract a Workspace into a Template:

- **You need to batch-create similar Agents** —for example, giving everyone on the team a "translation Agent"
- **You want to give new members a ready-to-use starting point** —they only need to create from the Template, not configure from scratch
- **The configuration is being iterated** —after the Template is updated, Workspaces bound to it can be upgraded with one click

In the Workspace's **Settings** app, under **General**, click **Save as Template**. You can choose whether to **bind** the current Workspace to this new Template (binding lets it follow updates).

### The relationship between Templates and Library Prompts

The two don't conflict; they're only complete when combined:

- **Templates** —manage the whole Agent's "default persona"
- **Library Prompts** —manage fine-grained iteration of the Prompt item alone

A common team practice is: the Prompt field in the Template references a Library Prompt. This way the Template provides the overall configuration baseline, the Prompt can iterate independently, and after an update all Workspaces created from the Template receive the new Prompt.

## Tags: organizing your Workspace list

Once dozens of Workspaces pile up, finding one starts to get hard. **Tags** are NAP's lightweight grouping tool.

Create and manage tags in the **Tags** app on the home screen (`⌘K` → **Tags**). Assign them to a Workspace in its **Settings** → **General**. The workspace switcher in the top menu bar filters the list by tag.

### Tag design suggestions

- By **purpose** —`production`, `staging`, `experiment`
- By **team** —`frontend`, `backend`, `data`
- By **status** —`active`, `archived`, `review`

Colors are for at-a-glance differentiation. Tag filtering is OR logic—when multiple are selected, anything matching any one of them is shown.

## Shared sessions

When debugging an Agent, you often need to send a session to a colleague to look at: you see the Agent took a wrong turn at some step and want a colleague to help diagnose it.

Use the share button on a session (available in **Chat** and **Session History**). This generates a public link that anyone can open to see the full conversation of this Session—messages, tool calls, file operations all visible.

Suitable scenarios:

- **Asking for help** —send the problematic session to someone on the team who knows it better
- **Demos** —show a business stakeholder a complete end-to-end flow
- **Retrospectives** —when an Agent performed especially well or especially badly, archive it for reference

Note that what you share is **public**—don't share sessions containing sensitive information.

## Workspace visibility and team collaboration

[Composing Agents](/guides/6-compose-agents/#visibility) covered how a Workspace's Visibility affects **who can call it**. The same field also affects **who can see it in their own list**:

- **Private** —only you can see it
- **User** —you can see it (it doesn't appear in others' lists)
- **Public** —visible to every user on the instance

The Prompts, Skills, and Templates in the Library follow the platform's unified three-level sharing scope — **Private** / **Team** / **Public**. Public suits capabilities the whole instance should share, Team scopes them to selected teams, and Private suits personal use or the experimental stage.

### A common team pattern

1. **Experiment in personal space** —tune Prompts and try skills in a Private Workspace, experimenting freely
2. **Extract to the Library once stable** —put the Prompt into Public Prompts and the skill into Public Skills
3. **Crystallize into a Template** —save the mature Workspace configuration as a Public Template so everyone on the team can create from it with one click
4. **Keep iterating** —through the Library's "auto-sync updates" mechanism, configuration improvements roll out automatically

This flow connects "personal exploration" and "team benefit"—what one person spends time tuning, the whole team gets to use.

## Next

By now you've walked the full path from "creating your first Agent" to "turning it into a team-level capability."

If you want to dive deep into a specific topic, return to the [Concepts](/concepts/overview/) chapter for a panoramic explanation of NAP's core concept groups.
