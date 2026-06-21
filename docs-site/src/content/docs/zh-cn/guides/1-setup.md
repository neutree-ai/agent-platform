---
title: 1. 准备工作
description: API 供应商和凭证——开始用 Neutree Agent Platform 之前最少要准备什么
---

创建第一个 Agent 之前，你需要确认两件事：

1. **有一个可用的 API 供应商**——Agent 跑起来后需要调用大模型 API
2. **（可选）Agent 要访问的资源对应的凭证已经准备好**——比如要操作私有 Git 仓库、调内部 API、登录某个第三方服务

第二件是按需的，绝大多数新用户只需要解决第一件。

## API 供应商：Agent 的大模型入口

API 供应商是你为 Neutree Agent Platform 配置的大模型 API 入口。它告诉平台：去哪里调用、用哪把 key、走什么协议。每个 Workspace 选一个供应商加一个具体模型（比如 `gpt-5.4`），所有 Session 的模型调用都走这条通道。

### 先看看现成的供应商

打开侧边栏的 **管理 → API 供应商**，里面通常已经有团队或平台共享的供应商（标记为 **Public**）。这些是平台管理员预先配好的，你直接选用即可。

如果列表里已经有合适的供应商，可以直接跳到[指南 2](/guides/2-first-agent/) 创建 Agent。

### 创建自己的供应商

如果共享的供应商不满足需求（想用自己的 API key 计费、或者要接一个团队没接的服务），点击 **新建 API 供应商** 创建一个 Private 供应商。从 Provider Type 里选一种：

| 协议类型 | 适用场景 |
|---|---|
| **OpenAI Compatible** | OpenAI 官方 API、Azure OpenAI、OpenRouter、各类国产大模型网关——任何兼容 OpenAI 协议的服务都走这一类。Codex agent 必须用这一类。 |
| **Anthropic** | 直连 Anthropic 官方 API，使用静态 API Key。 |
| **Anthropic OAuth** | 第三方提供 Anthropic 兼容协议且要求 OAuth 授权的服务。 |
| **Claude Code OAuth** | 用你个人的 Claude Pro / Team 订阅授权，无需 API Key。 |

填好 Base URL 和 API Key 后保存，供应商就可以被 Agent 使用了。

### Public 还是 Private

- **Private** ——只有你自己能用，适合个人 API key 或不希望共享的入口
- **Public** ——平台所有用户都能用，适合团队统一采购、希望大家都能接入的额度

普通用户默认选 Private。Public 供应商一般由管理员维护。

## 凭证：Agent 访问资源的钥匙

供应商让 Agent 能"思考"，凭证让 Agent 能"做事"——访问私有 Git 仓库、调内部 API、读云存储、登录数据库……所有需要身份验证的外部资源都靠凭证。

凭证在侧边栏的 **管理 → 凭证** 里管理，三种注入方式：

- **env** ——把值写入环境变量（如 `GITHUB_TOKEN`、`DATABASE_URL`）
- **file** ——把值写入容器内的某个文件（如 `~/.gitconfig`、`credentials.json`）
- **SSH Key** ——快捷创建私钥凭证，自动放在标准位置（`~/.ssh/id_ed25519`）

凭证创建后，在 Workspace 里勾选要用哪些。Agent 启动时会自动把这些凭证注入容器。

### 这一步要不要做

- 如果你的第一个 Agent 只是用大模型回答问题（比如总结文本、写邮件草稿），不需要任何凭证，直接进入下一章
- 如果你的 Agent 需要访问内部资源（Git、内部 API、SaaS 账号），等想清楚要做什么时再回来配置

## 准备就绪

只需要一句话总结：**管理 → API 供应商** 里有一个可用的供应商，就够了。可以去 [指南 2：第一个 Agent](/guides/2-first-agent/)。
