连接 Slack workspace，让平台能够通过 Socket Mode 实时接收 Slack 事件（如 @mention）。

## 所需凭据

- **Bot Token** (`xoxb-...`) — Slack App → OAuth & Permissions → Bot User OAuth Token
- **App Token** (`xapp-...`) — Slack App → Basic Information → App-Level Tokens，需要 `connections:write` scope

## 创建 Slack App

1. 前往 [api.slack.com/apps](https://api.slack.com/apps) 创建新 App
2. 开启 **Socket Mode**
3. 在 **OAuth & Permissions** 添加 Bot Token Scopes：`chat:write`, `channels:history`, `channels:read`, `app_mentions:read`
4. 在 **Basic Information** 创建 App-Level Token（scope: `connections:write`）
5. 安装 App 到 workspace

## 下一步

Connector 创建后，需要为具体的 Channel 创建 **Route** 来定义：
- 监听哪个频道（Channel ID）
- 触发哪个 Workspace 执行任务
- 如何将消息转为 prompt（模板）

## 测试

创建后平台会自动测试连接，验证 token 是否有效。
