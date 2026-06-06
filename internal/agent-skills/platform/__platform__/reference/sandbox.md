# Sandbox

Use sandbox MCP tools for untrusted code, unavailable runtimes, or anything that would pollute the workspace. To preview a web app: `create_sandbox` → start dev server → `sandbox_get_preview_url`. (Browser is for *interacting* with web pages, not previewing your own.)

## Default working directory

The sandbox container starts with cwd `/` (root). There is no pre-created `/workspace` directory. When running commands that produce or consume files, always pass an explicit `cwd` or create the directory first:

```
sandbox_run_command: mkdir -p /home/user && ...
sandbox_run_command: <your command>, cwd: "/home/user"
```

Use `/tmp` for ephemeral scratch files and `/home/user` (or any path you `mkdir`) for project work.
