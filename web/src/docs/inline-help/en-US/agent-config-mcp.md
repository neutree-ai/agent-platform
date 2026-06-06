## MCP config

Configure the [MCP](https://modelcontextprotocol.io) servers that the agent can access.

### Format

```json
{
  "mcpServers": {
    "server-name": {
      "type": "http",
      "url": "http://host:port/mcp"
    }
  }
}
```

### Supported transport types

| type | Description | Example |
|------|------|------|
| `http` | HTTP Streamable | `http://nap-cp:3000/mcp` |
| `stdio` | Local process | Requires the `command` + `args` fields |
