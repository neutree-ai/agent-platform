A memory store is a path-keyed collection of markdown files that the agent uses as long-term, cross-session memory.

## Model

- A **memory store** is a **user-level** resource — not bound to any workspace. One user can own multiple stores.
- Workspaces consume stores via **attachment** (max 8 per workspace).
- Once attached, the agent can read and write entries via the filesystem inside its container; every write is recorded in the history log.

## Slug

The `slug` is unique within your account and acts as a stable identifier. When the store is attached to a workspace, the slug becomes the mount directory name.

> Prefer short, semantic slugs: `personal`, `work-context`, `project-acme`.

## Path conventions

Memory paths are user-defined; we recommend grouping by intent:

- `/user/profile.md` — about you
- `/feedback/<topic>.md` — your preferences and corrections
- `/project/<slug>.md` — current project context
- `/reference/<system>.md` — pointers into external systems (Linear, Slack channels, etc.)

## Default store

Each user has at most one **default store**. It will be auto-attached to newly created workspaces in the future (onboarding flow — not yet wired).
