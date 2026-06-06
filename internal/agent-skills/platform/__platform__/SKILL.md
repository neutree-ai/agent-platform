---
name: __platform__
description: NAP workspace capabilities reference. Consult when working with browser automation, sandboxed code execution, file sharing between agents via /mnt/afs, persistent cross-session memory under /mnt/memory, creating or editing skills, proposing workspace configuration changes via Builder Mode, or (Codex) generated images.
---

# NAP Workspace Capabilities

The NAP platform provides several runtime facilities inside this workspace. Each capability has a dedicated reference file under `reference/`; read the matching one before using the capability, since exact tool names, paths, and gotchas live there.

## Browser Automation

Pre-installed `agent-browser` CLI plus `create_browser` / `delete_browser` MCP tools for driving a remote Chromium with live-view streaming. Downloads have a non-obvious retrieval flow.

→ When the user wants to fill forms, scrape pages, click through a UI, or share a live view — see `reference/browser.md`.

## Sandbox

`create_sandbox` MCP tools for isolated code execution and web-app preview URLs. Use it instead of polluting `/workspace` with throwaway runtimes.

→ When running untrusted code, exotic runtimes, or previewing a dev server — see `reference/sandbox.md`.

## File Sharing

Shared folders mounted at `/mnt/afs/<name>` let agents hand off files without inlining them in `call_agent` payloads.

→ When passing files between agents, or when a target agent should read directly from disk — see `reference/file-sharing.md`.

## Memory

Persistent, cross-session storage mounted under `/mnt/memory/<store_id>/`. Workspaces opt in by attaching memory stores; when attached, the entries are listed in the platform reminder. Use ordinary file tools — there are no dedicated memory tools.

→ Before reading or writing any file under `/mnt/memory/`, or when deciding what to persist — see `reference/memory.md` for the on-disk schema (frontmatter, type, index), recall workflow, and the conventions a background consolidation pass relies on.

## Skills

`skill_create_draft` / `skill_enter_edit` / `skill_publish` lifecycle for user-authored skills (this `__platform__` skill itself is platform-managed and not user-editable).

→ When the user wants to create, edit, or publish a skill — see `reference/skills.md`.

## Builder Mode

`workspace_*_propose` / `_apply` (and `<resource>_*_propose` / `_apply` for the prompt library) let you propose configuration changes — system prompt, schedules, slash commands, skills, model/provider, prompt library — that the user approves via an in-chat card before they apply. Read tools (`list_*`, `get_*`) are always on whenever any Builder cap is enabled.

→ When the user describes a configuration change in conversation rather than going to the UI form — see `reference/builder-mode.md` for the propose/approve/apply contract, scope semantics, and cross-cutting rules (ownership, versioning, source XOR, timezone, reference safety).

{{#codex}}
## Image Generation

Generated images land in `/workspace/.home/.codex/generated_images/` and should be surfaced inline.

→ When generating an image for the user — see `reference/image-generation.md`.

{{/codex}}
