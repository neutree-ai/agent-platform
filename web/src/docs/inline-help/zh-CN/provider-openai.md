接入 OpenAI 官方 API、Azure OpenAI，或任意实现了 OpenAI **Responses API** 的网关。

- **Base URL**: `https://api.openai.com` 或兼容服务的端点
- **API Key**: 对应服务的 API Key

## 要求

- 服务端必须实现 **Responses API**（`/v1/responses`）—— 只提供 Chat Completions（`/v1/chat/completions`）的服务**不能用**此类型，请改用 **OpenAI Chat Completions**

## Visibility

- **Private**: 仅自己可见
- **Team**: 共享给所选团队
- **Public**: 平台所有用户可见、可用
