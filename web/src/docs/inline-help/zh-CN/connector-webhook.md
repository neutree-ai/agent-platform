创建 Webhook 入口，允许外部系统通过 HTTP 请求触发 agent session。

Webhook connector 不需要配置凭据。

## 下一步

Connector 创建后，需要为具体的 endpoint path 创建 **Route** 来定义：
- 监听哪个路径（如 `/invoices`）
- 触发哪个 Workspace 执行任务
- Secret 验证（支持 Plain 和 HMAC-SHA256）
- 如何将请求内容转为 prompt（模板）
- 过滤规则（仅处理符合条件的请求）
