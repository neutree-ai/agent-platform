将 Slack 频道中的 @mention 事件路由到指定 Workspace 执行。

## 字段说明

- **Connector** — 选择已创建的 Slack connector
- **Channel** — 选择 bot 已加入的频道（仅列出 bot 所在频道）
- **Workspace** — 事件触发后在哪个 workspace 执行任务

## Prompt 模板

定义如何将 Slack 消息转为 agent prompt。可用变量：

| 变量 | 说明 |
|------|------|
| `{message}` | 用户发送的消息文本 |
| `{user}` | 发送者的 Slack User ID |
| `{thread_context}` | 同一 thread 的历史消息 |
| `{thread_ts}` | Thread 时间戳 |
| `{channel}` | Channel ID |

留空则直接使用原始消息。也可以从 Prompt 库中选择。

## Session TTL

同一 thread 内的消息在 TTL 时间窗口内共享同一个 session，实现多轮对话。默认 24 小时。
