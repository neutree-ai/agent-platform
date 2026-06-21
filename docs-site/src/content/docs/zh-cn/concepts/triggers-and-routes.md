---
title: Agent 从哪里接到任务
description: Web UI、Schedule、Connector + Route 三种触发方式
---

Workspace 创建好之后，Agent 怎么开始工作？Neutree Agent Platform 提供三种触发方式，从"人手动用"到"完全无人值守"都覆盖。

## 三种触发方式

| 触发方式 | 谁在叫它 | 典型场景 |
|---|---|---|
| **Web UI** | 你自己在浏览器里发起对话 | 日常调试、临时任务、探索性使用 |
| **Schedule** | 平台按 cron 表达式定时触发 | 每天早上跑一次报告、每小时查一次状态 |
| **Connector + Route** | 外部系统通过 Slack / Webhook 把事件送进来 | GitLab pipeline 失败时诊断、Slack 收到消息时应答 |

不管是哪一种，结果都一样：**在 Workspace 里开一个新 Session，把任务当初始 prompt 交给 Agent**。Agent 不知道也不关心是谁叫它——所以这几种触发方式可以自由组合。

## Web UI

最简单的情况。打开 Workspace，在对话框里输入文字、粘贴图片、敲一条 `/command`——一个 Session 就开始了。

适合：你对任务还没完全想清楚、需要边对话边调整、要看着 Agent 一步步做什么。所有新 Agent 都建议先用 Web UI 跑通一遍，再考虑怎么自动化。

## Schedule：定时触发

你给 Workspace 配置一个或多个定时任务，每个任务是一对 `(cron 表达式, prompt)`。到点时，平台自动在这个 Workspace 里创建一个新 Session，把 prompt 发出去。

Schedule 是**最便宜的自动化形式**——零外部依赖，不需要任何系统对接，只要 Agent 自己能完成任务就行。常见用法：每天早上让 Agent 巡检一次系统状态、每小时拉一次新邮件做摘要、每周一汇总上周的数据。

每次触发都是一个独立 Session，不共享上下文。如果你需要"接着上次的状态继续做"，应该用 Memory 或者把状态写到文件里，而不是依赖 Session 上下文。

## Connector + Route：外部系统推送事件

这是最强大、也是最需要解释的一种。它解决的是："GitLab pipeline 失败时，我想自动触发一个 Agent 去诊断"——让外部系统把事件送到 Neutree Agent Platform。

要让外部事件能进来，需要回答三个问题：

- **从哪里进来**——平台暴露一个端点等着接收
- **进来后归谁处理**——某个事件应该交给哪个 Workspace
- **怎么变成 Agent 听得懂的话**——HTTP 请求或 Slack 消息怎么变成一段 prompt

平台用两个对象来回答这三个问题：

### Connector：接收端点

Connector 是一个"接收端"。平台目前支持两种类型：

- **Webhook** — 暴露一个 HTTP 端点，外部系统 POST 过来。需要配置一个 secret 用于验签
- **Slack** — 接一个 Slack bot，监听 @ 这个 bot 的消息

一个 Connector 就是一个"门"。门本身不决定门后面发生什么——那是 Route 的事。

### Route：路由规则

一个 Connector 上可以挂多条 Route。每条 Route 定义了：

- **匹配什么事件**——Webhook 用 path + filter 规则（如 `body.build_status = failed`），Slack 用具体的 channel
- **触发哪个 Workspace**
- **如何把事件变成 prompt**——一段模板，里面可以引用 `{body}`、`{message}`、`{user}` 这些变量

举个具体的：GitLab 在某个 repo 配了 webhook 发到平台，平台这边的 Route 设置 `path = /ci-doctor`、filter = `build_status = failed`、workspace = `ci-doctor`、prompt 模板 = `以下是本次 CI job event 数据：{body}`。每次 job 失败，GitLab 把事件送过来，平台匹配 path、过滤通过之后，在对应 Workspace 里开一个新 Session 触发诊断。

### 为什么 Filter 重要

Filter 在 Route 层过滤，**在 Session 开出来之前就做完**。不匹配的事件直接丢掉，不启动 Agent，不烧 token。

也可以让 Agent 自己判断"这个事件该不该处理"——但每次都要先开 Session、加载上下文、调一次大模型，只为了"看一眼再决定不做"，浪费明显。原则是：**过滤条件能用固定规则写清楚，就放在 Route Filter 里**。Agent prompt 只处理需要语义理解的复杂判断。

## Provider 在哪里

Provider 不是一种触发方式——它是 Agent 跑起来时调用大模型 API 的底座。可以这样理解：触发方式决定"什么时候叫 Agent 工作"，Provider 决定"Agent 工作时拿什么去想"。这是两件独立的事。

每个 Workspace 选一个 Provider。Provider 在 **Management → Providers** 里集中管理，详见[指南 1](/guides/1-setup/)。

## 它们之间的全景

<pre class="mermaid">
flowchart TD
  UI["Web UI（手动对话）"]
  SCH["Schedule（cron 触发）"]
  CR["Connector + Route（外部系统推送）"]
  S(("新 Session"))
  A["Agent（Workspace 内运行）"]

  UI --> S
  SCH --> S
  CR --> S
  S --> A
</pre>

下一步可以去[指南 5](/guides/5-trigger-agents/) 看每种触发方式的具体配置步骤。
