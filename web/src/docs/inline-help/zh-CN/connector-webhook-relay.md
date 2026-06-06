接收来自外部服务（GitHub、Google Workspace 等）的 Webhook。事件通过公网 Relay 端点中转至内网 NAP。

## 工作原理

1. 外部服务将 Webhook 发送到 **公网 Relay URL**
2. Relay 将事件入队（SQS）
3. NAP 轮询队列并在本地处理事件

## 凭据

**基础设施（管理员配置）：**

- **Queue URL** — 由基础设施团队提供的 SQS 队列地址
- **Region** — SQS 队列所在的 AWS 区域（如 `us-east-1`）
- **Access Key ID / Secret Access Key** — 用于轮询队列的 AWS 凭证，使用 IAM Role 时可留空

## Relay Public URL

Relay 端点的公网地址（如 `https://xxx.execute-api.us-east-1.amazonaws.com/v1`）。用户创建 Route 时会在页面上看到这个地址，用于配置外部服务的 Webhook。

## Public Connector

启用 **Public connector** 可让所有用户使用此连接器。用户可以在上面创建自己的 Route，无需访问基础设施凭证。

## 下一步

Connector 创建后，需要为具体的 endpoint path 创建 **Route** 来定义：
- 监听哪个路径（如 `/github-push`）
- 触发哪个 Workspace 执行任务
- Secret 验证（支持 Plain 和 HMAC-SHA256，如 GitHub）
- 如何将请求内容转为 prompt（模板）
- 过滤规则（仅处理符合条件的请求）
