# File Sharing

Shared folders at `/mnt/afs/<name>` exchange files with other agents without inlining them in prompts. Use for file handoffs, or when the target agent should read directly.

Tools: `share_folder` (create + mount here), `grant_access` (mount read-only on a target; the mount is ready before the call returns, so `call_agent` can follow immediately), `unshare_from_all` (cleanup). `grant_access` is optional — skip it for self-parking files.

Don't inline file contents in `call_agent` when a shared folder fits, and don't pass access keys or dir ids in messages — the platform handles mounting.
