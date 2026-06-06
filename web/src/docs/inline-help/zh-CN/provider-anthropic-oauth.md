面向提供 Anthropic 兼容 API 的第三方服务，且使用 OAuth 认证（而非静态 API Key）。

- **Base URL**: 第三方服务的 API 端点
- **API Key**: 无需填写（通过 OAuth 流程获取 token）

## 适用场景

- 第三方平台提供了 Anthropic 协议兼容的 API，并要求 OAuth 登录
- 支持 Claude Code agent

## Visibility

- **Public**: 平台所有用户可见、可用
- **Private**: 仅自己可见
