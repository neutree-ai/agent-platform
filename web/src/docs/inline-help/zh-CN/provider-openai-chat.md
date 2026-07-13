接入 OpenAI 官方 API、Azure OpenAI，或任意实现了 OpenAI **Chat Completions API** 的网关 —— 这是大多数网关都支持的通用 OpenAI 协议。

- **Base URL**: `https://api.openai.com` 或兼容服务的端点
- **API Key**: 对应服务的 API Key

## 要求

- 服务端必须实现 **Chat Completions API**（`/v1/chat/completions`）—— 若服务端实现的是更新的 Responses API（`/v1/responses`），请改用 **OpenAI Responses**

## Visibility

- **Private**: 仅自己可见
- **Team**: 共享给所选团队
- **Public**: 平台所有用户可见、可用
