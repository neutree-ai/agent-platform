# Builder Mode

Builder Mode lets you propose configuration changes to the user's workspace (or account-wide resources like the prompt library) in-conversation. Each proposal becomes an approval card the user clicks Approve or Reject on; only on approval does the change apply. Use it when the user describes intent ("optimize my prompt", "schedule this daily", "use a different model") instead of filling UI forms.

## When the user shows intent: search for the tool first

The agent host may lazy-load MCP tools, so you might not see Builder Mode tools in your default toolset even when the user wants one. As soon as the user's intent matches a Builder capability (changing system prompt / model / provider; creating, editing, or deleting a schedule / slash command / prompt-library entry; enabling or disabling a skill on this workspace; renaming or changing visibility of this workspace), **actively look for the matching tool** — try the tool-search facility your host provides, or attempt the call directly (`workspace_<resource>_propose` for workspace scope, `<resource>_propose` for global scope).

If the search comes up empty after a real attempt, Builder Mode is either disabled for this workspace or set to the other scope. **Tell the user**: surface that Builder Mode isn't on (or is on the wrong scope), point them to Workspace Settings → MCP → Platform → Builder Mode, and ask which scope they want. Don't keep searching silently — the user can't enable a capability they didn't know existed.

## The propose → approve → apply contract

Every Builder action expands to a pair of tools sharing one payload schema: `<name>_propose` and `<name>_apply`.

1. **Propose.** You call `<name>_propose` with the payload you've designed. It writes a pending `agent_request` and returns `{ request_id, kind, label, payload, status: "pending" }`. The UI renders an approval card with the payload preview.
2. **User decides.** The user clicks Approve or Reject. On Approve, a system message appears in the chat instructing you to call `<name>_apply` with the `request_id`. On Reject, nothing happens — don't retry; ask the user what to change.
3. **Apply.** You call `<name>_apply(request_id)`. It re-parses the payload, verifies status is `approved`, claims the request via CAS, and runs the effect. One approval = one apply; concurrent attempts race on CAS and only one wins. The returned text is what the user sees in the chat.

**Never fabricate a `request_id`.** Only call apply when the conversation explicitly carries the approval message — that's the only legitimate trigger.

## Two scopes

| Scope | Tool names | What it touches |
|---|---|---|
| `workspace` (default) | `workspace_<resource>_propose` / `_apply` | The current workspace's own config |
| `global` | `<resource>_propose` / `_apply` (no prefix) | Account-wide resources — currently the user's prompt library only |

A workspace has at most one scope enabled at a time (set in Workspace Settings → MCP → Platform → Builder Mode). If a tool you expect isn't listed, the user picked the other scope or has Builder Mode off — surface that, don't guess.

## Read tools are always on

Whenever any Builder cap is enabled — regardless of scope — these read tools are available:

- `list_prompts`, `get_prompt`
- `list_skills`, `get_skill`
- `list_providers`
- `list_schedules`, `list_commands`, `get_command`
- `get_workspace_config`
- `list_sessions`, `get_session_export_urls` (past chats for analysis)

**Always read before proposing.** Don't propose a schedule named "Daily Review" without checking if one already exists; don't propose switching the system prompt without first fetching the workspace's current prompt source. The read layer is what lets you ground proposals in reality.

## Cross-cutting rules

### Ownership
Prompts in the library are owned by the user who created them. `prompt_update` / `prompt_delete` only succeed on prompts you own — team-shared and public prompts that show up in `list_prompts` are read-only from these tools.

### Versioning
On `prompt_update`, a `content` change bumps the prompt's version; name / visibility-only changes do not. Workspaces pinned to that prompt pick up the new content on their next reload.

### Reference safety
You cannot delete a prompt that any workspace still references. Apply hard-fails and lists the referring workspaces. The user must redirect those workspaces (via `workspace_prompt_propose` to a different prompt or inline text) before deletion can succeed.

### Source XOR — silent-clobber trap
Three resources share the same XOR pattern between inline content and a library reference:

- **Workspace system prompt**: `system_prompt` (inline) vs `prompt_id` (library)
- **Schedule**: `prompt` (inline) vs `prompt_id` (library)
- **Slash command**: `prompt` (inline; stored as `content`) vs `prompt_id` (library)

Setting one side automatically clears the other; never both. This is the trap when updating: if `get_command` / `list_schedules` / `get_workspace_config` shows a `library: <id>` marker (or the equivalent for prompts) but you propose an update with inline text, **the library reference is silently lost**. To preserve the reference, pass `prompt_id` instead; to switch to inline, pass `prompt` / `system_prompt`. Pass `""` to clear either side explicitly.

### Schedule timezones
Cron timezone is **required** — there is no silent UTC fallback. If the user says "every morning at 9" without naming a zone, ask before proposing. Use IANA names like `Asia/Shanghai` or `America/New_York`.

### Visibility default
New prompts default to `private`. Pass `visibility: 'public'` only when the user has explicitly asked to share account-wide.

### Provider / prompt visibility
Apply verifies that any `provider_id` or `prompt_id` is visible to the user. A propose with an unreachable id succeeds cheaply, but apply will fail. Prefer to pick from `list_providers` / `list_prompts` rather than passing a guessed id.

## Flow tips

- **One proposal at a time.** Don't queue multiple proposes hoping the user approves in order — each approval drives its own apply.
- **Ask when ambiguous.** Timezone, visibility, delete impact, multi-step intent — clarify before proposing, not after.
- **You design the diff.** When the user describes "what I want" rather than specific fields, your job is to translate that into a concrete payload. Read tools first, then propose.
- **Apply result = user-facing text.** The string `_apply` returns is what the user reads in the chat — keep it factual and brief, no marketing.
