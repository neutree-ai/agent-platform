---
title: 4. Extending the Workspace
description: Custom commands, Sandbox, MCP services, and custom UI tabs
---

[Guide 3](/guides/3-agent-behavior/) covered tuning a single Agent with off-the-shelf means. This chapter takes a step further out — **expanding the Agent's range of activity** by connecting it to tools and capabilities it didn't originally have.

Four things, from shallow to deep:

1. **Custom commands** — package frequently used prompts into one-click shortcuts
2. **Sandbox** — a temporary isolated container for the Agent to run code (this section is explanatory, to help you understand the "sandbox" panel you see in the product)
3. **MCP services** — connect the Agent to an independently running tool service
4. **Custom UI tabs** — embed the interface of a business system into the Workspace (an engineering-team topic)

Read on as needed; the further down you go, the more engineering-oriented it gets.

## Custom commands

If you find yourself repeatedly sending the same kind of prompt to the Agent, you should turn it into a command. Open **Automation** → **Commands** at the top of the Workspace, create a new one, and name the command something like `/review`.

### Command types

- **Plain** — fixed text, sent directly to the Agent when triggered
- **Struct** — a template with variables; triggering pops up a form for you to fill in values

A Struct template defines variables with double curly braces:

```
Please review the most recent commit on the {{BRANCH}} branch of repository {{REPO}}.
Focus on: {{FOCUS}}
```

When you type `/review` in the input box to trigger it, three input fields — `REPO`, `BRANCH`, `FOCUS` — pop up; after filling them in, the result is sent as the initial message of this conversation.

### Command content source

- **Custom** — write it directly in the configuration
- **Library Prompt** — reference a shared Prompt from the library. When the Prompt is updated, all referencing parties sync automatically

The latter is suitable when multiple Agents share the same set of commands.

## Sandbox: A temporary container for the Agent to run code

The Workspace's built-in runtime environment (**Files / Terminal**) is enough for the Agent's day-to-day file operations and command calls, but when the Agent needs to **actually run a piece of code** — execute a Python script to verify an idea, run a bit of SQL to see the result, temporarily compile a tool — it needs a clean, isolated, disposable environment. That's the **Sandbox**.

A Sandbox is not the Workspace's own runtime environment, but **another container the Agent creates on demand**. Each sandbox has its own independent image, CPU, memory, and timeout; it's destroyed once it's done and won't pollute the Workspace's file system.

### Who creates the sandbox

The platform has a built-in set of MCP tools exposed to the Agent, letting it manage sandboxes autonomously:

- `create_sandbox` — create one on demand
- `sandbox_run_command` — execute a command inside it
- `sandbox_read_file` / `sandbox_write_files` — read and write files inside the sandbox
- `kill_sandbox` — destroy it when done

In other words, when the Agent wants to "run some code and see the result," it calls these tools itself — you don't need to configure anything. **Sandbox is an out-of-the-box capability, not an extension you need to enable.**

### Where you can see it

The Workspace has a **Sandbox** panel that lists all currently active sandboxes: the image, resources, and remaining time-to-live of each. You can also manually create a sandbox here for debugging — fill in the image address, CPU, memory, and timeout, then confirm.

### Image selection

Each time you create a sandbox, you need to choose a Docker image. The platform pre-warms two common ones for sub-second startup:

- `node:22-bookworm` — Node.js environment
- `python:3.12-bookworm` — Python environment

You can also fill in **any Docker image address** — the first startup needs to pull it, and it's cached afterward. If the team has its own standard image (preinstalled with certain tools or an internal CLI), you can put it in a registry for Agents / users to use.

### What you need to remember from this section

1. The Workspace's own runtime environment is **fixed** and the image cannot be changed
2. When the Agent needs to run code, it creates a **sandbox** via MCP tools — choosing the image per task and discarding it when done
3. You don't need to configure the sandbox separately; it's a built-in platform capability
4. To see which sandboxes the Agent is currently running, go to the Workspace's **Sandbox** panel

## MCP services

MCP (Model Context Protocol) is a standardized protocol that lets an Agent call tools provided by an **independently running service**. The difference from Skills is covered in [Agent Anatomy](/concepts/agent-anatomy/): Skills are files mounted into the container, read and used by the Agent itself; MCP is a protocol-layer call to an external service, suitable for "connecting external systems, crossing networks, having its own state."

### Connecting an existing MCP service

If the team has already deployed an MCP service, connecting it only takes a few lines in the Agent configuration:

Open **Agent Config** → **Settings** and find the **MCP Configuration** area. Configuration format:

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

Two transports are supported:

| Type | When to use |
|---|---|
| `http` | A remote HTTP Streamable service |
| `stdio` | A local process, requires the `command` + `args` fields |

After saving, the Agent restarts and connects automatically at startup, and all the tools that service exposes become capabilities the Agent can call.

### Deploying your own MCP service

If you need to give the Agent a brand-new capability, and that capability **has its own data, state, or background process**, then it's worth building it as an MCP service.

Writing an MCP service is essentially writing an ordinary backend service that exposes a tool interface per the [MCP specification](https://modelcontextprotocol.io). The common approach is to use the official SDK:

- TypeScript — `@modelcontextprotocol/sdk`
- Python — `mcp`

After deploying, fill its URL into the Agent configuration and the Agent can use it. The specific deployment details are an engineering topic beyond the scope of this guide — if your team has engineers, it's best to coordinate with them directly.

## Custom UI tabs (Mini SaaS)

> This section is an engineering-team topic. Users who don't write code can skip it.

The tab bar at the top of the Workspace (**Files / Terminal**, etc.) is extensible — you can register a standalone web interface as a tab of the Workspace, so that while the Agent works, users can directly see the real-time status of the relevant business.

This integration pattern is called **Mini SaaS** — an independently deployed microservice integrated back into the platform through three standardized channels:

- **Management UI** — a standalone management interface for maintaining domain data (such as a terminology base, a rule set, a knowledge base)
- **MCP service** — a tool interface for the Agent to call
- **UI tab** — a custom panel embedded in the Workspace

If your business scenario needs this kind of deep integration, it's best to contact the Neutree Agent Platform team to discuss an approach.

## Next

At this point the Agent's "capability surface" has a complete set of extension means. The next chapter covers how to make the Agent **triggered by more than just manual conversation** — [Guide 5: Triggering Agents](/guides/5-trigger-agents/).
