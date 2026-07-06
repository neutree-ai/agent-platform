Codex agent 使用的 provider 类型。接入 OpenAI 官方 API、Azure OpenAI，或实现了 OpenAI 协议的网关。

- **Base URL**: `https://api.openai.com` 或兼容服务的端点
- **API Key**: 对应服务的 API Key

## 要求

- Codex 走 **Responses API**（`/v1/responses`），服务端必须实现它 —— 只提供 Chat Completions（`/v1/chat/completions`）的服务**不能用**
- Codex agent 只能用这一类型；Claude Code agent 请用 Anthropic 系列类型

## 注意事项

- OpenRouter 免费模型需在模型名后加 `:free` 后缀，如 `stepfun/step-3.5-flash:free`

## Visibility

- **Private**: 仅自己可见
- **Team**: 共享给所选团队
- **Public**: 平台所有用户可见、可用
