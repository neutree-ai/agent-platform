---
title: "AFS: Cross-Agent file sharing"
description: A permissioned shared file system that lets workspaces hand files to each other
---

Every workspace has its own file system. That isolation is the point — but it also means a file A writes is invisible to B. When several agents work on one deliverable (a planner splits the work, workers each take a piece, someone files the result), they need a controlled way to share files.

**AFS (Agent File System)** is what NAP provides for that: a permissioned shared file system that an agent sees as a directory in its container, and a user sees as the **Cloud Drive** tab in the Files app.

## What it solves

Without it, moving a file between workspaces means either stuffing the content into the conversation or relaying it through object storage. The first blows up context; the second adds credentials to manage. AFS makes it infrastructure instead:

- **Share a path, not the content** — one agent writes into the shared directory, the other reads the same path in its own container. Nothing serialized, nothing transferred
- **Permissioned** — whoever shares decides who gets in, and whether they can write
- **Revocation is clean** — stop sharing and every mount point goes invalid at once

## What you see

### The user's side: the Cloud Drive tab

Open the workspace's **Files** app and there are two tabs:

- **Local** — this workspace's own file system
- **Cloud Drive** — every shared directory this workspace can see

Each item under Cloud Drive is a **shared directory**, either one you created or one another workspace shared with you. You can:

- **Create one** — name it (lowercase letters, digits, hyphens) and it mounts into your own workspace at the same time
- **Manage members** — let your other workspaces in, read-only or read-write
- **Stop sharing** — revoke one member, or destroy the directory outright

A shared directory appears at the same path, `/mnt/afs/<name>`, for everyone who mounts it. That stability is the core contract: **the path does not change from one workspace to the next.**

### The agent's side: platform MCP tools

The agent doesn't use the web interface. It manages sharing through built-in MCP tools, which work with no setup:

- `share_folder(name)` — create or ensure a shared directory, mounted at its own `/mnt/afs/<name>`
- `grant_access(name, slug, readonly?)` — let another workspace in, by slug; that workspace sees the same path immediately
- `unshare_from_all(name)` — revoke every share and destroy the underlying storage

So an agent can run the whole sequence — create a share, write files, grant a collaborator access, call them — inside one conversation, with nobody stepping in.

## A typical flow: call_agent + AFS

A common shape: a parent agent prepares material and hands the next step to a child. Pasting the material into the prompt would blow up context. Through AFS it's straightforward:

1. parent calls `share_folder("task-2026-05")` and gets `/mnt/afs/task-2026-05/`
2. parent writes the files to hand over into that directory, with its ordinary file tools — the path is just a path
3. parent calls `grant_access("task-2026-05", "child-agent", readonly=true)`; the child's workspace sees the files at the same path
4. parent calls the child ([Composing Agents](/guides/6-compose-agents/)), and the prompt only has to name the path: `"Process the files under /mnt/afs/task-2026-05/"`
5. child reads the path in its own container, does the work, and either writes the result back (if read-write) or into its own local files

## How it works

> Internals, for the curious. None of it changes how you use AFS.

AFS is a separate set of components, written in Rust, in two kinds of process:

- **afs-controller** — the metadata and authorization service, gRPC, metadata in SQLite. It registers storage backends, creates and destroys shared directories, and records which host has mounted what
- **afs-fuse** — a FUSE daemon, one per agent host, also gRPC. Told to mount, it exposes the shared directory at the given path through [FUSE](https://www.kernel.org/doc/html/latest/filesystems/fuse.html) and proxies reads and writes to the storage backend

**Storage backends**, two of them today:

- **local** — a directory on the controller's own host, for a single machine or a shared volume
- **nfs** — an NFS export, so every agent host works on the same copy

Each shared directory gets an immutable `access_key` when it's created. The key and the read-only/read-write mode are enforced on the gRPC calls: a host that wants to mount has to present the right key, and on revocation the controller tells every mounting afs-fuse to unmount by force. The path inside the container disappears on the spot.

In NAP the shape is: one afs-controller in the cluster, one afs-fuse sidecar injected into each workspace pod, and the control plane mapping "user / workspace / who-shared-with-whom" onto the controller's "directory / mount / access_key". Users and agents see the Cloud Drive and the MCP tools; access keys and directory IDs stay underneath.

## A few habits worth having

**Keep directory names stable.** Once a slug and a directory name are written into a prompt or a skill, renaming breaks the reference. Choose the name as if it's permanent.

**Default to read-only.** Read-only sharing has no write contention to reason about. Open read-write only when a child actually has to write something back.

**Clean up.** After a one-off task, `unshare_from_all` reclaims the directory so the share list doesn't silt up. Long-running team drives are worth keeping.

**Don't use it as object storage.** AFS is built for handing files over during collaboration, not for bulk cold storage. Size it like a working directory.
