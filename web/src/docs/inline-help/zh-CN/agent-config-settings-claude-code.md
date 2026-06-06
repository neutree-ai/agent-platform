## Agent Settings

传递给 Claude Code 运行时的配置参数。

### 权限控制

```json
{
  "permissions": {
    "allow": ["Bash(git *)"],
    "deny": ["Bash(rm *)"]
  }
}
```

- **allow** — 允许的工具模式，如 `"Bash(git *)"` 允许所有 git 命令
- **deny** — 禁止的工具模式，如 `"Bash(rm *)"` 阻止删除操作

### 其他字段

- **enableAllProjectMcpServers** — 是否启用项目 `.mcp.json` 中定义的 MCP 服务（默认 `true`）
