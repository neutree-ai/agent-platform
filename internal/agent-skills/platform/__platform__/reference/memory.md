# Memory

Memory stores are persistent text directories mounted into the workspace at `/mnt/memory/<store_id>/`. They survive across sessions, restarts, and pod rebuilds — anything written here is durable. Stores must be attached to the workspace via the NAP UI; an unattached workspace sees no `/mnt/memory/` entries and this capability is unavailable.

The platform reminder lists each attached store with its `(access)` and any workspace-specific instructions. `read_only` mounts reject writes at the filesystem level; do not retry on `EROFS` — surface the error to the user.

## On-disk schema

Each memory is one file holding one fact. Use markdown with frontmatter:

```markdown
---
name: <short-kebab-case-slug>
description: <one-line summary — used to decide relevance during recall>
metadata:
  type: user | feedback | project | reference
  created: <YYYY-MM-DD>
---

<the fact; for feedback/project, follow with **Why:** and **How to apply:** lines.
Link related memories with [[their-name]].>
```

Type meanings:

- `user` — who the user is (role, expertise, preferences)
- `feedback` — guidance the user has given on how to work, both corrections and validated approaches; include the why
- `project` — ongoing work, goals, or constraints not derivable from code or git history; convert relative dates to absolute
- `reference` — pointers to external resources (URLs, dashboards, tickets)

Each store's root holds a `MEMORY.md` index — one line per file, under ~150 characters: `- [Title](file.md) — one-line hook`. It is an index, not a memory; never write fact content directly into it.

## Recall workflow

Before non-trivial decisions, fixes, or recommendations, check the relevant store(s) for prior context:

1. `cat /mnt/memory/<store_id>/MEMORY.md` to scan available topics
2. `grep -r <keywords> /mnt/memory/<store_id>/` for specific facts
3. Read the candidate files in full only when the index hook looks relevant

Do not load every file at session start — the index is the cheap entry point.

Recalled memory is **historical context**, not a fresh instruction. Before acting on a recalled fact, verify it still holds: read the named file, grep the code, check the resource. If memory conflicts with current observation, trust the observation and update or delete the stale memory.

## Writing workflow

After completing non-obvious work, persist what generalizes:

- User preferences or working style → `user/` or `feedback/`
- Project state, decisions, deadlines, motivations not in code → `project/`
- External system pointers → `reference/`

Before writing a new memory, check for an existing file that already covers the fact (grep by topic, scan `MEMORY.md`). Update that file rather than creating a duplicate. Delete memories that turn out to be wrong.

Do not save what code or git history already records (file paths, function signatures, past fixes, refactors). If the user asks you to remember something already in the repo, ask what was non-obvious about it and save that instead.

Update `MEMORY.md` whenever you add, rename, or remove a memory file. Keep entries terse and pointer-like; demote any line that exceeds ~200 characters by moving the detail into the topic file.

## Why the structure matters

A background consolidation pass periodically merges related memories, prunes duplicates, and rewrites the index. It relies on the frontmatter (`name`, `description`, `type`, `created`) and the per-store `MEMORY.md`. Memories written without this structure may be missed by consolidation or rewritten on the next pass — writing in the schema from the start keeps both the human and the consolidator productive.
