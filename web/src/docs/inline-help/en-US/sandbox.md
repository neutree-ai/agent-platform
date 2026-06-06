Sandbox is an isolated container environment used to run code, execute commands, and perform file operations.

## Image

Any Docker image address. Bookworm images are recommended (preinstalled with tools such as git/curl/ps):
- `node:22-bookworm` — Node.js environment (prewarmed, starts in seconds)
- `python:3.12-bookworm` — Python environment (prewarmed, starts in seconds)
- Other images can also be used; the first startup requires pulling the image

## Resource configuration

- **CPU**: Kubernetes CPU units — `500m` = 0.5 core, `1` = 1 core
- **Memory**: `256Mi`, `512Mi`, `1Gi`, etc.

## Timeout

How long the Sandbox lives before it is destroyed automatically. The following formats are supported:
- `30s` — 30 seconds
- `10m` — 10 minutes
- `1h` — 1 hour (default)
- `1d` — 1 day
- Plain numbers are interpreted as seconds

## Usage

A Sandbox can be created and managed automatically by an agent through MCP tools, or created manually here. Available tools for the agent include:
- `create_sandbox` — Create a Sandbox
- `sandbox_run_command` — Execute a command
- `sandbox_read_file` / `sandbox_write_files` — Read and write files
- `kill_sandbox` — Destroy a Sandbox
