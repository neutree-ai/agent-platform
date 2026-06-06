## Agent settings

Configuration parameters passed to the Claude Code runtime.

### Permission control

```json
{
  "permissions": {
    "allow": ["Bash(git *)"],
    "deny": ["Bash(rm *)"]
  }
}
```

- **allow** — Allowed tool patterns, such as `"Bash(git *)"` allowing all git commands
- **deny** — Denied tool patterns, such as `"Bash(rm *)"` blocking delete operations

### Other fields

- **enableAllProjectMcpServers** — Whether to enable MCP services defined in the project `.mcp.json` (default `true`)
