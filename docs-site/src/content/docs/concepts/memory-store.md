---
title: Memory Store
description: Structured memory that outlives a session, shared across workspaces and exposed to agents as files
---

Sessions are independent by default: what the agent learned last time isn't there the next time. The **memory store** is how NAP closes that gap — whatever you or the agent write into it enters the agent's working context from the next session onward.

The memory store replaces the early "one Markdown file per workspace" version of memory, and it brings:

- One workspace can mount several stores; one store can mount onto several workspaces
- A store holds **many records**, each **versioned** — traceable, reversible
- Each record has a **type**: user / feedback / project / reference
- The agent sees **plain files**, and reads them with grep, pipes and on-demand reads

## Why a single Markdown stopped working

The old version had three concrete problems:

- **Hard to read** — the agent had to read all of it, every time. It grows long, while the part that matters to the conversation at hand is usually a paragraph
- **Hard to write precisely** — the only semantics were replace-all and append. Changing one section meant rewriting the whole thing (expensive, easy to lose content) or appending (steadily messier)
- **No structure** — everything in one document. Different kinds of task recorded different kinds of thing, all landing in the same place

The new design exists to untangle those three.

## How a memory store is put together

### Stores and workspaces are not welded together

Open the **Memory** app from the home screen (`⌘K` → **Memory**). The left pane lists every store on the account.

- Create a workspace and a store of the same name is created and mounted for you, so the default really does look one-to-one
- But **the relationship is loose**: create a store and mount it onto one workspace or several, and mount the same store in more than one place to share it

> When the new version shipped, each workspace's old single Memory was migrated into the store of the same name.

Two layering patterns come out of this in practice:

- **A user-level store** — your preferences (what language to talk in, what style you like), mounted onto all of your workspaces
- **A workspace-level store** — this agent's project knowledge, mounted onto one workspace only
- **A temporary shared store** — two workspaces working the same problem, mounting the same memory while it lasts

### Many memories, with versions

Open a store and you get a **list**, one record per memory.

Every write keeps a **version snapshot**. You can read old versions and roll back to any of them — Git-like semantics that turn memory from a black box into something you can inspect and undo.

### Memory types

Creating a memory means picking one of four types. They are **not customizable**:

| Type | Leans toward | Example |
|---|---|---|
| **user** | Account-wide personality, preferences, inclinations | "I prefer to talk in Portuguese", "code style leans PEP 8" |
| **feedback** | Corrections from the conversation at hand | "Be terser", "Don't mix English into Chinese" |
| **project** | Project knowledge, task-shaped | "This project runs PostgreSQL, main tables under the `app_user` database", "a bare DROP TABLE took us down once" |
| **reference** | Pointers outward | "Read https://internal-wiki/foo before answering this kind of question" |

> The classification follows Claude's own memory system, which Claude Code and its hosted agents share. We don't have enough data of our own yet to claim it's optimal — but following a scheme already proven at scale beats designing one from nothing. It'll grow as usage tells us more.

## Exposed as files

This is the design decision that matters most: **the store is exposed inside the agent's container as files**, under `/mnt/memory/<store-name>/`.

So reading and writing memory isn't a special API. It's ordinary file work:

```bash
# what the agent does
ls /mnt/memory/
cat /mnt/memory/user-prefs/language.md
grep -r "DROP TABLE" /mnt/memory/
echo "new preference" >> /mnt/memory/user-prefs/notes.md
```

Why go this way? Because models have a deep, native fluency with files: `cat`, `grep`, `head`, `tail`, `sed` and pipes, used to read exactly as much as is needed. Any bespoke API would need another stretch of prompt teaching the agent how to drive it, and would still be worse than what it already knows.

The gap is widest on **writes**. Merging several files into memory is one bash call with a pipe — the agent never has to emit the content as tokens and paste it. No MCP tool has matched that yet.

### The `MEMORY.md` index

At the root of each store, `MEMORY.md` (uppercase) is a **special file**:

- The agent maintains it: add, change or drop a memory and it updates the index in the same breath
- The platform **inlines it into the system prompt**

So from startup the agent can see which stores are mounted and what's in each. The bodies stay in the subfiles; having read the outline, the agent reads **only what it needs**. That's the whole efficiency argument for this design.

Think of `MEMORY.md` as the board at the library entrance and the subfiles as the shelves. The agent knows what's there on the way in, and walks over for the one it wants.

## The platform prompt layer

To make a mechanism like this work, NAP stacks a **platform prompt** on top of the system prompt you wrote. The platform maintains it and assembles it per session:

- Notes on the agent type and the registered built-in skills (the `platform` skill, for one)
- **The names of every mounted store, plus each store's `MEMORY.md`**
- A few standing suggestions about tool use

So at startup the agent can see what memory it has, what's in it, and where to go for the detail — none of which you have to write into your own prompt.

Your system prompt is unaffected; the platform prompt is a shared layer above it.

## How it works

> Internals, for the curious. None of it changes how you use the store.

**The database is the source of truth**: stores, records, versions and the `(workspace, store)` mount relationship are all tables in the control plane. That's what makes batch organization, cross-workspace indexing, and later continuous memory upkeep possible at all.

What the agent sees is files. The bridge between the two is a sidecar in each agent pod, `memory-fuse`:

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

- **On mount** — at startup, or on a `mount`/`umount` signal, the sidecar asks the control plane which stores this workspace has and what's in them, and writes the content into a local cache
- **On read** — FUSE intercepts the read and serves it from cache. It doesn't go to the database each time; a single grep can touch many files, and a round trip per file would be miserable
- **On write** — FUSE intercepts the write and turns it into the matching control plane call (create / update / delete), which lands in the database, then refreshes the cache so the next read agrees with it

Why not expose memory as MCP tools? Two reasons:

1. **Reading flexibility** — the model already knows `grep`, `head`, `tail`, reading by line and by fragment. A bespoke read interface would have to rebuild all of that and then spend prompt teaching it
2. **Pipes on write** — a file system supports `cat a.md b.md | tee /mnt/memory/x.md` as one coherent move, so content never has to come back through tokens. MCP has no equivalent

> This lines up closely with how Claude's hosted agents work — from outside analysis and our own testing, they take a similar sidecar-plus-FUSE route to make memory look like files.

## Habits worth having

**Let the agent tidy its own memory.** Stores migrated from the old version usually start as one block of stale notes. Tell the agent to reorganize the store along best practice and it will split it, classify it and maintain the index itself.

**Write a good `MEMORY.md`.** The sharper the index, the better the agent's on-demand reads hit. A sentence or two per memory is enough; leave the body in the subfiles.

**Layer the mounts.** Account-level preferences (language, style) in a standalone user store mounted everywhere; project knowledge in a workspace-level store. Don't put it all in one.

**Keep secrets out.** API keys and passwords belong in [Credentials](/guides/4-extend-workspace/#credentials-keys-to-external-resources). A memory store is agent context by design, and context goes into the conversation.

## Next

- Hands-on: mount a store and write your first memory → [Defining Agent Behavior](/guides/3-agent-behavior/#memory-recall-across-sessions)
- Where this sits among the agent's five parts → [Anatomy of an Agent](/concepts/agent-anatomy/#memory-long-term-memory-across-sessions)
