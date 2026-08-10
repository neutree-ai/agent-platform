---
title: Neutree Agent Platform 是什么
description: 把你已经在用的 Agent 搬到自己的基础设施上，托管起来，团队一起用
---

多数人第一次用 Agent 是在自己机器上：一个终端、一个人、一次一个 session。这样够用，直到 Agent 得在你合上笔记本之后继续干活，或者别的团队也想用同一个。

Neutree Agent Platform（NAP）就是它的下一站。core、prompt、skills 还是你现在这套，变的是它们跑在你自己的 Kubernetes 集群里，成为一个多人共用的托管服务，7×24 在线，等你或者外部系统把活交过来。

## 平台替你管掉的那半

写个原型 Agent 不难：一个脚本、一个 prompt、几行 API 调用。难的是把它变成团队天天靠着用的东西，而这部分工作跟 Agent 本身要干什么几乎没关系：

- **一直在线** — 不是想起来才手动跑一次的脚本
- **随处能叫到** — Slack 里的一条 thread、一次 HTTP 调用、CI 的 webhook、一个定时。五个入口，同一个 Agent
- **跑在边界里** — 能执行 shell、读文件、装工具，但都在你划的范围内
- **团队共用** — 一个人调好的 prompt，别人指过来就用上了，不用各自复制一份
- **不被一家绑死** — core 可以换，配置属于 Workspace，不属于当下跑着的那个 core

这半边平台管。你管的是这个 Agent 该干什么。

## Agent 的一生：构建 → 分发 → 优化

在 NAP 上经营一个 Agent，会反复走这三段，文档也按这条主线组织：

- **构建** — 一个中立、可替换的 core，用 prompt、skills 和 MCP 塑形，底下是平台跑好的中间件，Agent 自己不用带。从[第一个 Agent](/zh-cn/guides/2-first-agent/) 开始。
- **分发** — 一个 Workspace，五个入口都进得来，按负载选服务形态。用的人那边什么都不用管：不装、不配、也不用自己的 key。见[触发 Agent](/zh-cn/guides/5-trigger-agents/)。
- **优化** — Agent 读自己的会话历史，提出改自己 prompt 和 skills 的方案。你不批准就不生效。见[优化](/zh-cn/concepts/optimize/)。

## 贯穿全站的四组词

读完整套文档，你会反复遇到这四组词——先混个脸熟就好，后面每一组都有专门的章节展开：

- **Workspace / Agent / Session** — Workspace 是 Agent 的"工位"，里面有它的配置、文件、对话记录。Agent 是这份配置跑起来之后的实例。Session 是一次具体的对话或任务。
- **Model / Prompt / Skills / MCP / Memory** — 五件套，分别决定 Agent 的"脑子、身份、肌肉记忆、外部工具、长期记忆"。你能调的就是这五件。
- **中间件（Middleware）** — 平台在每个 Workspace 底下跑好的能力，Agent 不用自己带：[code sandbox](/zh-cn/self-host/sandbox-browser/)、remote browser、Agent 之间互相调用、[跨 Agent 文件系统](/zh-cn/concepts/afs/)、[memory store](/zh-cn/concepts/memory-store/)、MCP 连接。打开开关就有，不用自己做一遍。
- **Provider / Connector / Route / Schedule** — 决定 Agent 从哪里接到任务。Provider 给它接大模型 API，Connector 加 Route 把外部事件送进来，Schedule 让它按时自己启动。

## 设计思路：每层各管一段

这几层是刻意分开的。Agent core（Claude Code / Codex / Goose）和模型分开，Agent 配置和触发方式分开，单个 Agent 和团队的复用资源（Library）分开。代价是要多记几个词，好处要等到某一层真要换的时候才显出来：换 core，prompt、skills、schedule 原样跟着走，因为它们属于 Workspace；某个模型 API 用不了了，换一个 Provider 接着跑。

## 接下来读什么

- 想先建立完整心智模型 → 顺序读完[概念](/zh-cn/concepts/agent-and-workspace/)章节，约 10 分钟
- 想立刻动手 → 跳到[准备工作](/zh-cn/guides/1-setup/)，跑通第一个 Agent
