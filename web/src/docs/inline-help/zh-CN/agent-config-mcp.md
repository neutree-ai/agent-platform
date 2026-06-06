## MCP Config

配置 agent 可访问的 [MCP](https://modelcontextprotocol.io) 服务端。

### 格式

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

### 支持的传输类型

| type | 说明 | 示例 |
|------|------|------|
| `http` | HTTP Streamable | `http://nap-cp:3000/mcp` |
| `stdio` | 本地进程 | 需要 `command` + `args` 字段 |
