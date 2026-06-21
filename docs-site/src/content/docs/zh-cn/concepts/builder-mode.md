---
title: Builder Mode：让 Agent 自己配置 Workspace
description: 在对话里让 Agent 修改自己的 Workspace 配置
---

Workspace 的配置 —— system prompt、启用的 skills、定时任务、模型选型，都能在 UI 表单里改。但你越用越会发现，有些调整在对话里说一句更顺手：

> "我最近几个聊天里你都问错重点，看看是不是 prompt 哪里有问题，改清楚一点。"
>
> "把刚才这套提问做成一个 `/review` 命令。"
>
> "每天早上 9 点帮我跑一次。"

**Builder Mode** 就是让 Agent 在对话里听懂这类话——它会把改动以提案的形式发到你面前，你点一下「批准」，改动就会生效。

## 核心价值

- **比表单更灵活，且能发挥 Agent 的智能**——你只描述意图，怎么改由 Agent 设计。它知道当前 prompt 长什么样、如何联动多个配置完成目标，比你手动调考虑得更周全
- **改动可以从过去的对话里来**——Agent 能拉出最近的聊天记录回头分析，提议"你前几次都因为这段 prompt 卡住，建议改成这样"
- **每一笔改动你来批准**——Agent 不会绕过你直接改。每个提议都是聊天里的一张审批卡片，可以预览本次的改动内容，点「批准」或「拒绝」，改动才生效

## 适用场景

- 想优化 prompt 但不知道从哪改起——让 Agent 看几个最近的对话再提议
- 同一类提问反复发——让 Agent 自己存成命令
- 加/调一个定时任务，描述清楚需求就行，不必学习 cron 表达式
- 切换模型 / provider / 启动 skill，直接说"换成 xxx"
- 参数你不确定——比如你说"按中国时区"，Agent 知道映射到 `Asia/Shanghai`，不会用一个你看不懂的选项卡住你

## 不适用场景

- **跨 Workspace 编辑**——为安全起见，Builder Mode 默认只能改当前 Workspace 自己的配置（账号范围档另说，见 [指南 3](/guides/3-agent-behavior/#开启-builder-mode)）
- **细颗粒度的字段微调**——比如 prompt 里改一个字，UI 编辑器也许更顺手

## 审批模型的安全保证

Builder Mode 里 Agent 的每一笔改动都要走"提议 → 用户审批 → apply"两步。这不止是 UX 上的"确认一下"，背后还有一层结构上的兜底。

**你审批的 = 你 apply 的**——提议生成时，平台会把这次改动的完整原数据落到后端，**返回一个 ID**。审批通过后，Agent 调 `apply` 工具时传的是这个 **ID，不是 raw payload**。后台拿到 ID 后：

1. 用 ID 找到原始的审批数据
2. 校验它确实符合对应资源（schedule / prompt / skill 等）的 schema
3. 通过后才真正写入

这意味着：

- Agent 没办法在 apply 时"偷偷"换成一份你没看过的 payload——它能传的只是一个 ID
- 平台会再做一层 schema 校验——比如一个 cron 表达式即便通过了你的肉眼审批，schema 不合规也会被后端拒掉

UI 上每个审批卡片都把原数据**拆成字段展示**（不是吐一段裸 JSON），让 review 不那么费劲。点开就能看到字段、字段含义、改动内容；不喜欢就拒绝，喜欢就点一下批准。

## 历史 Session 的读取机制

Builder Mode 一个很有用的场景是让 Agent "看几个最近的对话，分析我的 prompt 哪里需要改"。要做到这一点，Agent 得能读到历史 session 的内容。

但**直接把 session 内容塞进工具结果不可行**——session 可能很长，几万行 tool call 一次性灌进 context 会浪费 token 还读不全。

所以 builder 工具的做法是：返回一个**导出 URL**，Agent 用 `curl` / `bash` 把它下载成本地文件，再用文件工具（grep、按需读片段）去分析。这样：

- 主对话的 context 只承担"分析过程"，不承担 session 的原始内容
- Agent 能用它最熟悉的文件操作语义，按需读取相关部分

这是为什么 Builder Mode 比早期的"提示词优化器"独立功能更高效——后者要你手动选几个 session、手动声明优化目标，Agent 只能基于你给的几个 session 做分析；Builder Mode 让 Agent 在对话里自己列 session、按需下载、自己定优化思路，并且最后通过同一套审批机制落地。

> 老用户提示：原本的 **提示词优化器** 实验功能已经下架。Builder Mode 是它的更好版本——不需要离开熟悉的对话入口，session 选择、主题声明、改动落地都在同一个对话里完成。

让 Agent 复盘历史 session、改进自己的配置，这件事本身属于[优化](/concepts/optimize/)——Builder Mode 是它落地和审批的入口；优化的全貌（自主调优、后续的模型替换）在那一章展开。

---

具体开启方法和能力清单见 [指南 3：开启 Builder Mode](/guides/3-agent-behavior/#开启-builder-mode)。
