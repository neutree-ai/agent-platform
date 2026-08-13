将 Slack 频道中的 @mention 事件路由到指定 Workspace 执行。

## 字段说明

- **Connector** — 选择已创建的 Slack connector
- **Channel** — 选择 bot 已加入的频道（仅列出 bot 所在频道）。选 **All channels** 就是给这个 connector 配兜底路由：凡是没单独建过路由的频道都走这条，新建频道不用再加规则。兜底会接管别人可能正在用的频道，所以只有 connector 的创建者能配；别人分享给你的 connector 上不出现这个选项
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
| `{channel_name}` | Channel 名称（获取失败时为空，如 DM 场景） |

留空则直接使用原始消息。也可以从 Prompt 库中选择。

## Session TTL

同一 thread 内的消息在 TTL 时间窗口内共享同一个 session，实现多轮对话。默认 24 小时。
