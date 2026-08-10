---
title: 4. Extending the Workspace
description: Custom commands, credentials, sandboxes, MCP services and custom UI tabs
---

[The last chapter](/guides/3-agent-behavior/) shaped a single agent with what's already there. This one reaches further out — **widening what the agent can touch** by connecting it to capability it didn't start with.

Five things, shallow to deep:

1. **Custom commands** — prompts you keep retyping, turned into one click
2. **Credentials** — keys to external resources (Git, internal APIs, third-party services)
3. **Sandbox** — a throwaway container for running code (explanatory: this is the Sandbox panel you've seen in the product)
4. **MCP services** — connecting the agent to a service that runs on its own
5. **Custom UI tabs** — embedding a business system's interface into the workspace (an engineering topic)

Read as far down as you need. It gets more engineering-shaped as it goes.

## Custom commands

When you notice yourself sending the same shape of prompt over and over, make it a command. Open the **Automation** app (`⌘K` → **Automation**), switch to **Commands**, create one, and name it something like `/review`.

### Command types

- **Plain** — fixed text, sent as-is when triggered
- **Struct** — a template with variables; triggering opens a form to fill in

A Struct template marks variables with double braces:

```
Review the most recent commit on the {{BRANCH}} branch of {{REPO}}.
Focus on: {{FOCUS}}
```

Type `/review` in the input box and three fields appear — `REPO`, `BRANCH`, `FOCUS`. Fill them in and the result becomes the conversation's first message.

### Where a command's content comes from

- **Custom** — written into the command itself
- **Library Prompt** — a shared prompt from the library, which syncs to everything referencing it whenever it changes

The second is the one you want when several agents share a set of commands.

## Credentials: Keys to external resources

A provider lets the agent think. Credentials let it *do things*: reach a private Git repository, call an internal API, sign in to a third-party service. Anything that needs authentication goes through one.

`⌘K` → **Credentials** → create. Three ways to inject:

- **env** — lands in an environment variable (`GITHUB_TOKEN`, `DATABASE_URL`)
- **file** — written to a file in the container (`~/.gitconfig`, `credentials.json`)
- **SSH Key** — a shortcut for a private key, placed at `~/.ssh/id_ed25519`

Each credential declares its **scope**: every workspace of yours, or only the ones you choose. When a container starts, everything in scope is injected, and the agent reads `$GITHUB_TOKEN` or the file exactly as it would on any machine.

Open the dialog and the right side documents the fields for each injection method.

## Sandbox: a throwaway container for running code

The workspace's own environment (**Files / Terminal**) is enough for everyday file work and commands. But when the agent needs to **actually run something** — a Python script to test an idea, a bit of SQL to see what comes back, a tool compiled for one job — it wants somewhere clean, isolated and disposable. That's the **sandbox**.

A sandbox is not the workspace's environment. It's **another container the agent creates on demand**, with its own image, CPU, memory and timeout, destroyed when it's finished and leaving the workspace's file system untouched.

### Who creates it

The platform exposes a set of MCP tools for exactly this, so the agent manages sandboxes itself:

- `create_sandbox` — bring one up
- `sandbox_run_command` — run something in it
- `sandbox_read_file` / `sandbox_write_files` — read and write inside it
- `kill_sandbox` — tear it down

So when the agent wants to run code and look at the result, it calls these itself and you configure nothing. **The sandbox is there from the start, not an extension to enable.**

### Where you can see it

The workspace has a **Sandbox** panel listing what's alive right now: image, resources and remaining time-to-live for each. You can also create one here by hand for debugging — image address, CPU, memory, timeout.

### Choosing an image

Each sandbox needs a Docker image. Two are pre-warmed for sub-second starts:

- `node:22-bookworm`
- `python:3.12-bookworm`

**Any Docker image address** works. The first start pulls it; after that it's cached. If your team has a standard image with its tools or internal CLI preinstalled, put it in a registry and agents and users can name it.

### What to take away

1. The workspace's own environment is **fixed** — its image can't be changed
2. To run code, the agent creates a **sandbox** through MCP tools, picking the image per task and throwing it away after
3. There's nothing to configure; it's built in
4. To see what's running, open the workspace's **Sandbox** panel

## MCP services

MCP (Model Context Protocol) is a standard for calling tools provided by a **service that runs on its own**. How it differs from skills is in [Anatomy of an Agent](/concepts/agent-anatomy/): a skill is files in the container that the agent reads and runs itself; MCP is a call across the wire, for capability that lives outside, holds its own state, and is somebody else's to run.

### Connecting a service that already exists

If the team has an MCP service deployed, connecting it is a few lines of configuration.

Open **Settings** → **MCP**:

```json
{
  "mcpServers": {
    "my-service": {
      "type": "http",
      "url": "http://my-service.internal/mcp"
    }
  }
}
```

Two transports:

| Type | When |
|---|---|
| `http` | A remote HTTP Streamable service |
| `stdio` | A local process; needs `command` and `args` |

Save, the agent restarts, and it connects at startup. Everything the service exposes becomes callable.

### Building your own

If the capability you want is genuinely new, and it **has its own data, state or background work**, it's worth building as an MCP service.

Writing one is writing an ordinary backend service that exposes a tool interface per the [MCP specification](https://modelcontextprotocol.io). The usual route is an official SDK:

- TypeScript — `@modelcontextprotocol/sdk`
- Python — `mcp`

Deploy it, put its URL in the configuration, and the agent has it. The deployment itself is beyond this guide; if your team has engineers, it's their kind of job.

## Custom UI tabs (Mini SaaS)

> An engineering topic. Skip it if you don't write code.

A workspace's apps (**Files**, **Terminal**, and the rest) are extensible: register a standalone web interface as one, and while the agent works, users can watch the business state it's acting on.

This shape is called **Mini SaaS** — an independently deployed service integrated back through three standard channels:

- **Management UI** — a standalone interface for maintaining domain data (a terminology base, a rule set, a knowledge base)
- **MCP service** — the tool interface the agent calls
- **UI tab** — a panel embedded in the workspace

If your scenario needs integration this deep, come and talk it through in [Discord](https://discord.gg/MnsQ73d8dq) or [Discussions](https://github.com/orgs/neutree-ai/discussions) before you build.

## Next

The agent's surface now has a full set of ways to extend it. Next: getting it started by something other than you typing — [Triggering Agents](/guides/5-trigger-agents/).
