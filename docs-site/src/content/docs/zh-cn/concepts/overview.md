---
title: Neutree Agent Platform 是什么
description: 让 Agent 在公司里真正跑起来的 Agent Cloud
---

你已经知道云是什么——软件不必自己买服务器、配网络、管运维，这些交给云，你只管写业务。Neutree Agent Platform（NAP）做的是同一件事，只是把对象从软件换成 Agent：运行环境、触发、协作、复用都由平台承担，你只需要定义"这个 Agent 该干什么"。

这就是 **Agent Cloud**。你创建的 Agent 运行在 Kubernetes 集群里，7×24 在线，等你或外部系统把任务交过来。

## 它解决什么问题

写一个能跑通的原型 Agent 不难——一个 Python 脚本、一个 prompt、几行 API 调用就够了。但要把它变成"团队天天用、和现有系统对接、出问题能查、新人能改"的东西，就开始麻烦了：

- 它得**始终在线**，不是你手动运行才动起来的脚本
- 它得能**被外部系统触发**——GitLab 失败了、Slack 来消息了、定时到点了
- 它得有**可控的执行环境**——能跑 shell、能读文件、能装工具，但又不能乱来
- 它得能**被团队复用**——一个人调好的 prompt，别人能直接用上
- 它得**不被一家供应商绑死**——今天用 Claude，明天 OpenAI 的某个新模型可能更便宜

NAP 把这些事情都收敛到一个平台里。你专注于"这个 Agent 该干什么"，剩下的交给平台。

## Agent 的一生：构建 → 分发 → 优化

在 NAP 上经营一个 Agent，会反复走这三段——文档也按这条主线组织：

- **构建** — 定义它是谁、能做什么：模型、prompt、skills、外部工具、human-in-loop 界面。从[第一个 Agent](/guides/2-first-agent/) 开始。
- **分发** — 让它随时随地为人所用：定时、外部事件、API 触发，多 Agent 协作，团队复用。见[触发 Agent](/guides/5-trigger-agents/)。
- **优化** — 让它越用越好：复盘真实会话历史，持续压低单任务成本、提升任务成功率。见[优化](/concepts/optimize/)。

## 贯穿全站的三组词

读完整套文档，你会反复遇到这三组词——先混个脸熟就好，后面每一组都有专门的章节展开：

- **Workspace / Agent / Session** — Workspace 是 Agent 的"工位"，里面有它的配置、文件、对话记录。Agent 是这份配置跑起来之后的实例。Session 是一次具体的对话或任务。
- **Model / Prompt / Skills / MCP / Memory** — 五件套，分别决定 Agent 的"脑子、身份、肌肉记忆、外部工具、长期记忆"。你能调的就是这五件。
- **Provider / Connector / Route / Schedule** — 决定 Agent 从哪里接到任务。Provider 给它接大模型 API，Connector + Route 负责把外部事件送进来，Schedule 让它按时自己启动。

## 设计思路：每层各管一段

这几组概念之间是刻意分开的。Agent 引擎（Claude Code / Codex）和模型分开，Agent 配置和触发方式分开，单个 Agent 和团队的复用资源（Library）分开。代价是要多记几个词，好处是日后想换其中某一层，其他几层基本不用动——比如某天某个模型 API 用不了了，换一个 Provider 就能继续，prompt 和 skills 不动。

## 接下来读什么

- 想先建立完整心智模型 → 顺序读完[概念](/concepts/agent-and-workspace/)章节，约 10 分钟
- 想立刻动手 → 跳到[指南 1：准备工作](/guides/1-setup/)，跑通第一个 Agent
