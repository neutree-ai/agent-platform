---
title: "AFS: Cross-Agent file sharing"
description: A permissioned shared file system that lets Workspaces exchange files safely
---

Every Workspace has its own independent file system — this is the basis of Workspace isolation, but it also means that a file A writes is, by default, invisible to B. When multiple Agents need to collaborate on delivering an artifact (for example, a planner splits tasks, workers each do a segment, and finally it's archived), you need a controllable way to share files between Workspaces.

**AFS (Agent File System)** is the capability NAP provides for this: a permissioned shared file system that, to an Agent, is just a directory in its container, and to a user, is the "Cloud Drive" tab in the **Files** app.

## What it solves

Without AFS, passing files across Workspaces is only possible by stuffing the content into the conversation or relaying it through third-party object storage — the former blows up the context, and the latter adds a layer of credential management. AFS turns this layer into infrastructure:

- **Share by path, not by content** — an Agent writes a file to the shared directory, and the other party reads it at the same path directly in its own container; no serialization, no transfer needed
- **Permission-controlled** — the sharing party decides who can access and whether it's read-only or writable
- **Clean revocation** — once the sharing party stops sharing, all mount points immediately become invalid

## The visible parts

### User's view: the "Cloud Drive" tab in the Files app

Open the Workspace's **Files** app, and there are two tabs at the top:

- **Local** — this Workspace's own file system
- **Cloud Drive** — all shared directories the current Workspace can see

Under the "Cloud Drive" root, each item is a **shared directory**: one you created, or one another Workspace shared with you. You can:

- **Create a shared directory** — give it a name (lowercase letters, digits, hyphens), and it gets mounted into your own Workspace at the same time
- **Manage members** — grant your other Workspaces access to this shared directory, choosing read-only or read-write
- **Stop sharing** — revoke a member's access, or destroy the entire shared directory

A shared directory appears as the same path `/mnt/afs/<name>` to all parties that mount it — this is AFS's core contract: **the path is stable** and doesn't change across Workspaces.

### Agent's view: platform MCP tools

The Agent doesn't look at the web interface directly; it manages sharing through the platform's built-in MCP tools. These tools work out of the box and don't need separate configuration:

- `share_folder(name)` — create/ensure a shared directory, mounting it at its own Workspace's `/mnt/afs/<name>`
- `grant_access(name, slug, readonly?)` — grant another Workspace access to this shared directory (identified by its slug); the target Workspace immediately sees the same-named path
- `unshare_from_all(name)` — revoke all sharing of the directory and destroy the underlying storage

In other words, an Agent can autonomously complete the entire flow of "create a share → write files → grant access to a collaborator → call that party" within a conversation, with no human intervention required.

## A typical flow: call_agent + AFS

A common collaboration scenario: a parent agent prepares a set of materials and has a child agent complete the next step based on them. Pasting the content directly into the prompt would blow up the context, but going through AFS is smooth:

1. parent calls `share_folder("task-2026-05")` — gets the mount point `/mnt/afs/task-2026-05/`
2. parent writes the files to hand off into this directory (using its usual file tools; the path is just an ordinary file)
3. parent calls `grant_access("task-2026-05", "child-agent", readonly=true)` — the child's Workspace immediately sees these files at the same-named path
4. parent calls the child agent (see [Multi-Agent collaboration](/guides/6-compose-agents/)), and the prompt only needs to reference the path: `"Please process the files under /mnt/afs/task-2026-05/"`
5. child reads the path directly in its own container, completes the task, and can write the artifact back (if access is read_write) or write it to its own Workspace's local

## How it works (a primer)

> This section is for those curious about the internals; it doesn't affect usage.

AFS is an independent set of components (implemented in Rust), made up of two kinds of processes:

- **afs-controller** — the centralized metadata + authorization service, with a gRPC interface and metadata stored in SQLite. It registers storage backends, creates/destroys shared directories, and records which hosts have mounted which directories
- **afs-fuse** — a FUSE daemon that runs one copy on each agent host, with a gRPC interface. On receiving a mount instruction, it exposes the shared directory at the specified path via [FUSE](https://www.kernel.org/doc/html/latest/filesystems/fuse.html), with file reads and writes proxied to the corresponding storage backend

**Storage backends** currently support two kinds:

- **local** — a local directory on the host where the controller resides (suited for single-machine or shared volumes)
- **nfs** — mount an NFS export so that all agent hosts share the same copy of data

When each shared directory is created, the controller assigns it an immutable `access_key`. The access credential and the read-only/read-write mode at mount time are enforced by gRPC calls — any host that wants to mount this directory must present the correct key, and on revocation the controller notifies all mounting parties' afs-fuse to force an unmount, and that path in the business container vanishes instantly.

In NAP, the shape of this set of components is: one afs-controller runs in the cluster, and each Workspace pod has an afs-fuse sidecar injected; the control plane maps the higher-level "user/Workspace/sharing-relationship" semantics onto the controller's "directory/mount/access_key" model — so what users and Agents see is the "Cloud Drive" and the MCP tools, without directly dealing with low-level concepts like access_key and directory IDs.

To Agents and users, all of this is transparent — what they see is just a directory.

## A few usage tips

**Keep directory names stable** — once the slug + directory name agreed upon between Agents is written into a prompt or skill, renaming will break the reference. Think it through when naming.

**Default to read-only; open read_write only when collaborative write-back is needed** — read-only sharing has no contended-write problems and is safer. Open the permission separately only when a child agent needs to write an artifact back.

**Destroy when done** — after a one-off task ends, use `unshare_from_all` to reclaim the shared directory, so the share list doesn't keep piling up. Directories of a long-running "team drive" nature can be kept.

**Don't use AFS as object storage** — AFS is designed for file handoff during Agent collaboration, not large-scale cold storage. Understand the file volume and access patterns in terms of a "working directory."
