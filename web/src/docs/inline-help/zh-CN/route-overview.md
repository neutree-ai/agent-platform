Route 将外部事件（Slack 消息、Webhook 请求）路由到指定 Workspace 执行 agent 任务。

## 支持的 Connector 类型

### Slack
- 监听频道中的 @mention 事件
- 支持多轮对话（同一 thread 共享 session）
- 可用模板变量：`{message}`, `{user}`, `{thread_context}`, `{channel}`

### Webhook
- 接收外部 HTTP POST 请求
- 支持 filter 规则过滤事件
- 可用模板变量：`{body}`, `{body.field}`, `{query.key}`, `{headers.name}`, `{method}`, `{path}`

选择 Connector 后，右侧文档会切换为对应类型的详细配置说明。
