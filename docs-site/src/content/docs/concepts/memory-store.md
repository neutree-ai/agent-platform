---
title: Memory Store
description: A structured memory system reusable across Workspaces, exposed to Agents as files
---

By default, each Agent's sessions are independent of one another—what was learned in the last conversation isn't automatically remembered in the next. Neutree Agent Platform (NAP) solves this with the **Memory Store**: content that you or the Agent write in enters the Agent's working context on every subsequent session.

The Memory Store is the new version (replacing the early "one single Markdown per Workspace" simple Memory), and it brings several capabilities:

- One Workspace can mount multiple memory stores; one memory store can also be mounted to multiple Workspaces
- A store holds **multiple records**, each with a **version**—traceable and reversible
- Each record has a **type** (user / feedback / project / reference)
- Exposed to the Agent as **plain files**, usable with grep, bash pipes, and on-demand reads

## Why a Single Markdown No Longer Works

The pain points of the old version were concrete:

- **Hard to read**—the Agent had to read the entire memory in full every time. Over a long session the content grows long, but the part relevant to the current conversation might be just a small section
- **Hard to write precisely**—there were only two semantics, "full replace / append." To change one small section, you either rewrote the whole text (token-costly, easy to lose content) or appended (increasingly messy)
- **No structure**—everything was mixed into one document. When the Agent wanted to record different things for different types of tasks, it all ended up in one place, hard to maintain

The new version's design goals are precisely to untangle these three things.

## The Structure of the Memory Store

### The decoupled relationship between stores and Workspaces

Open the **Memory** app on the home screen (`⌘K` → **Memory**). The left pane lists all memory stores under the current account.

- When you create a new Workspace, the system automatically creates a memory store of the same name and mounts it—so by default what you see is "one-to-one correspondence"
- But **the relationship is decoupled**: you can create a new store and manually mount it to one or more Workspaces; you can also mount the same store to multiple Workspaces to share it

> When this new version launched, a migration was performed—the single Memory content of each Workspace in the old version is migrated into the corresponding memory store of the same name.

This brings two practical layering patterns:

- **User-level shared memory store**—record "my" preferences (which language to converse in, preferred style), mounted to all your Workspaces
- **Workspace-specific memory store**—record the current Agent's project knowledge, mounted to only one Workspace
- **Cross-Workspace temporary sharing**—when two Workspaces collaborate on one thing, temporarily mount the same memory

### Multiple memories and version management

Open any store and you see a **list**—each memory is an independent record.

Every time you write to memory, the platform retains a **version snapshot**. You can view historical versions and roll back to any version—similar in semantics to Git, turning memory from "a black-box document" into something you can see and return to.

### Memory types

When creating a new memory, you must choose one of these four types; you **cannot customize** them:

| Type | Tendency | Example |
|---|---|---|
| **user** | Account-global personality / preferences / inclinations | "I prefer conversing in Portuguese", "code style leans toward PEP 8" |
| **feedback** | Immediate feedback within the current conversation | "Be more concise when replying", "Don't mix Chinese and English" |
| **project** | Task-centered, project-level knowledge | "This project uses PostgreSQL, with the main table under the `app_user` database", "Last time a direct DROP TABLE blew up" |
| **reference** | External references | "Before answering this kind of question, first read https://internal-wiki/foo" |

> This classification follows Claude's official memory system (both Claude Code and its hosted Agents use the same set of types). We don't yet have enough quantitative data to prove this is the optimal classification, but choosing to follow a scheme already validated at scale is more reliable than designing one from scratch. We'll expand it later based on usage data.

## Exposure as Files

This is the new version's most critical design decision: **the memory store is exposed as files inside the Agent container**, mounted under `/mnt/memory/<store-name>/`.

That is—when the Agent reads and writes memory, it doesn't use some special API; it uses **plain file operations**:

```bash
# Agent's perspective
ls /mnt/memory/
cat /mnt/memory/user-prefs/language.md
grep -r "DROP TABLE" /mnt/memory/
echo "new preference" >> /mnt/memory/user-prefs/notes.md
```

Why do this? Because LLMs have a very deep native **affordance** for file reads and writes: they use the whole toolset of `cat`, `grep`, `head`, `tail`, `sed`, and bash pipes to read and write efficiently on demand. Any custom API would require writing another stretch of prompt to teach the Agent how to use it, and that's less efficient than directly reusing the file semantics it already knows.

This is especially true for **writes**—by piping to merge multiple files directly into memory, the Agent can do it in a single bash call, without having to emit the content as tokens and then paste it. This is an efficiency that MCP tools have so far struggled to match.

### The `MEMORY.md` index file

In each store's root directory, `MEMORY.md` (uppercase) is a **special index file**:

- Maintained autonomously by the Agent—every time it adds/modifies/deletes a memory entry, the Agent updates this index in sync
- It is **inlined directly into the Agent's system prompt** by the platform

So as soon as the Agent starts, it can see from the system prompt: which stores are currently mounted and what the outline of each store is. The full content of any specific memory still lives in subfiles; after seeing the outline, the Agent reads **on demand**—this is the core of the new version's efficient reading.

An analogy: `MEMORY.md` is the index board at the library entrance, and the subfiles are the books on the shelves. The Agent knows what books exist and what each is about as soon as it enters; to read a particular one, it walks over and flips it open.

## The Platform Prompt Layer

To make a mechanism like the Memory Store work, NAP injects an additional **"platform prompt"** layer on top of the system prompt you write. This prompt layer is maintained automatically by the platform and is assembled dynamically:

- References explaining the Agent type and registered built-in skills (such as the `platform` skill)
- **The names of all currently mounted memory stores + the `MEMORY.md` index content of each store**
- Some always-resident tool-usage suggestions

So when the Agent starts, it can "see" which memories are available, the outline of each, and where to go for a deeper read—without the user having to hand-write guidance in their own prompt.

The system prompt you write yourself is still fully in effect; the platform prompt is just a layer of shared context stacked on top.

## How It Works

> This section is for those curious about the internals; it doesn't affect usage.

The **source of truth for the Memory Store is the database**—stores, records, versions, and the `(workspace, store)` mount relationship are all tables in the control plane database. This is what lets the backend do batch organization, cross-Workspace indexing, and future "continuous memory organization" features.

But what the Agent sees is files. The bridge between the two is a sidecar container injected into each Agent pod—`memory-fuse`:

```
┌─────────────────────────┐    ┌──────────────────────┐
│  Agent container         │    │ memory-fuse sidecar   │
│   read/write             │    │                       │
│  /mnt/memory/<store>/   │◄──►│  FUSE mount point     │
│                          │    │  ↕                    │
└─────────────────────────┘    │  local cache (file    │
                                │  copies)              │
                                │  ↕                    │
                                │  control plane API    │
                                └────────────┬──────────┘
                                             ↓
                                          DB (stores/records/versions)
```

- **On mount**—when the sidecar starts or receives a `mount/umount` signal, it pulls from the control plane which stores this Workspace has mounted and which memories are in them, writing the content to the local cache directory
- **Agent reads**—FUSE intercepts read requests and returns directly on a local cache hit; it doesn't hit the DB every time (an operation like grep may hit many files at once, and going back to the DB each time would perform very poorly)
- **Agent writes**—FUSE intercepts write requests and translates them into the corresponding control plane API calls (create / update / delete), ultimately landing in the DB; it also refreshes the local cache so subsequent reads see a consistent state

Why not expose memory via MCP tools? Two reasons:

1. **Read flexibility**—LLMs already know how to use `grep`, `head`, `tail`, read by line, and read by fragment. A custom MCP read interface would have to reimplement these semantics and spend prompt teaching the Agent to use them
2. **Write pipe capability**—the file system supports coherent operations like `cat a.md b.md | tee /mnt/memory/x.md`, so the Agent doesn't need to bring content back into tokens and emit it. MCP currently has no equivalent pipe semantics

> This mechanism is also highly consistent with Claude's hosted Agents—based on external analysis and our own testing, they too use a similar sidecar + FUSE approach to make memory "look like files."

## Usage Recommendations

**Let the Agent organize memory itself**—especially for stores migrated up from the old version, where the first record is usually one big block of stale notes. Just tell the Agent to "reorganize this memory store according to best practices," and it will split, categorize, and maintain the index on its own.

**Write a good `MEMORY.md`**—the clearer the index, the higher the hit rate of the Agent's on-demand reads. A one- or two-sentence summary of each memory in the index is enough; leave the body to the subfiles.

**Layer your mounts**—put account-level preferences (language, style) in a standalone "user memory store" mounted to all Workspaces; put project knowledge in a Workspace-specific store. Don't cram everything into one store.

**Don't put sensitive information in the Memory Store**—use [Credentials](/guides/1-setup/#credentials-your-agents-keys-to-resources) for API keys and passwords. The Memory Store is essentially Agent context and enters the conversation, so it's not suitable for secrets.

## Next

- Hands-on: mount a memory store and write your first memory → [Defining Agent Behavior](/guides/3-agent-behavior/#memory-recall-across-sessions)
- How this mechanism relates to the Agent's five core parts → [The Anatomy of an Agent](/concepts/agent-anatomy/#memory-long-term-memory-across-sessions)
