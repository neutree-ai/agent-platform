OpenAI 兼容协议，覆盖面最广。除了 OpenAI 官方 API，也适用于所有提供 OpenAI 兼容端点的第三方服务（OpenRouter、Azure OpenAI、各类国产大模型网关等）。

- **Base URL**: `https://api.openai.com` 或第三方服务的 API 端点
- **API Key**: 对应服务的 API Key

## 适用场景

- Codex agent（**仅支持此类型**）
- OpenRouter 免费/付费模型
- Azure OpenAI 部署
- 其他 OpenAI 兼容服务

## 注意事项

- OpenRouter 免费模型需在模型名后加 `:free` 后缀，如 `stepfun/step-3.5-flash:free`
- Codex agent 仅支持 openai 类型的 provider

## Visibility

- **Public**: 平台所有用户可见、可用
- **Private**: 仅自己可见
