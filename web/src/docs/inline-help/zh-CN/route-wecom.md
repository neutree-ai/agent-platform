将企业微信群聊中的 @机器人 消息路由到指定 Workspace 执行。

## 字段说明

- **Connector** — 选择已创建的企业微信 connector
- **群聊 ID** — 企业微信群聊 ID（格式 `wrXXX...`），可从测试脚本日志的 `chatid` 字段获取
- **Workspace** — 事件触发后在哪个 workspace 执行任务

## Prompt 模板

定义如何将企业微信消息转为 agent prompt。可用变量：

| 变量 | 说明 |
|------|------|
| `{message}` | 用户发送的消息文本 |
| `{user}` | 发送者的企业微信 UserID（aibot 回调只下发 userid，无姓名/邮箱） |
| `{channel}` | 群聊 ID；单聊时为合成的 `user:<userid>` |
| `{chat_type}` | `single`（单聊）或 `group`（群聊） |

留空则直接使用原始消息。也可以从 Prompt 库中选择。

## Session TTL

由于企业微信无原生 thread，平台通过群聊 ID + 时间窗口自动管理会话。同一群内在 TTL 时间窗口内的消息共享同一个 session。默认 24 小时。
