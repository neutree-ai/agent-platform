---
title: 1. 准备工作
description: 接入大模型 API 供应商 —— 创建第一个 Agent 前唯一要准备的事
---

:::note[还没有可登录的平台实例？]
指南默认你已经有一个可以登录的 Neutree Agent Platform 实例。如果还没有，[一行命令装一个](/zh-cn/self-host/single-node/)。
:::

创建第一个 Agent 之前，你只需要准备一样东西：一个可用的 **API 供应商** —— Agent 调用大模型走的通道。每个 Workspace 选一个供应商加一个具体模型，所有 Session 的模型调用都走这条通道。

## 创建 API 供应商

按 `⌘K`（Windows / Linux 为 `Ctrl+K`）搜索 **API 供应商** 打开，点击 **新建 API 供应商**。（团队实例里管理员可能已经共享了 **Public** 供应商 —— 有合适的直接选用，然后去[创建你的第一个 Agent](/zh-cn/guides/2-first-agent/)。）

Provider Type 必须和你要跑的 agent、手里的 API 对得上：

| 协议类型 | 对应 Agent | 适用场景 |
|---|---|---|
| **OpenAI Compatible** | Codex | 实现了 OpenAI **Responses API** 的服务 —— OpenAI 官方 API、Azure OpenAI，或支持 Responses 的网关。**只提供 Chat Completions 的服务不能用**：Codex 依赖 Responses API。 |
| **Anthropic** | Claude Code | Anthropic 官方 API，使用静态 API Key。 |
| **Anthropic OAuth** | Claude Code | 第三方提供的 Anthropic 兼容 API —— 大部分都走这一类。填服务商给的 Base URL 和 key 即可；名字里虽有 OAuth，**并没有 OAuth 授权步骤**，只是复用了同一套协议。 |
| **Claude Code OAuth** | Claude Code | 你个人的 Claude Pro / Team 订阅。本地执行 `claude setup-token`，把得到的 token 粘贴进来 —— 不需要 Base URL。 |

判断方法：跑 Codex → 第一行，并确认服务支持 Responses；跑 Claude Code → 后三行按你的 API 来源选（官方 key / 第三方兼容 API / 个人订阅）。

按所选类型填好保存，供应商就绪。

## 共享范围

与平台上所有可共享资源一致，供应商遵循统一的三层 scope：**Private**（仅自己）、**Team**（团队成员）、**Public**（实例内所有人）。个人 key 默认 Private；Public 供应商通常由管理员维护。

## 可以开始了

只要 **API 供应商** 列表里有一个可用的供应商，就绪 —— 去[创建你的第一个 Agent](/zh-cn/guides/2-first-agent/)。
