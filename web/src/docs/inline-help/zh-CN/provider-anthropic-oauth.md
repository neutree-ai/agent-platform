面向提供 **Anthropic 兼容 API** 的第三方服务 —— 大部分第三方 Claude 服务都走这一类。供 Claude Code agent 使用。

名字里虽有 OAuth，**并没有 OAuth 授权步骤**：这一类型只是复用了同一套协议。按服务商给的信息填写即可：

- **Base URL**: 第三方服务的 API 端点
- **API Key**: 服务商签发的 key 或 token

## 适用场景

- 服务商或网关以 Anthropic 兼容协议提供 Claude 模型

## Visibility

- **Private**: 仅自己可见
- **Team**: 共享给所选团队
- **Public**: 平台所有用户可见、可用
