---
title: Teamwork：让多 Agent 协同完成一次任务
description: 任务级的多 Agent 协作场景，自动管理可见性、共享目录和协作时间线
---

> Teamwork 当前是预览版（preview）。基本机制已稳定，最终形态可能调整，欢迎在使用中给我们反馈。

Neutree Agent Platform（NAP）上的多 Agent 协作能力一直都有：在任意 Workspace 里 `@agent/slug` 就能调另一个 Agent；要传文件就用 [AFS](/zh-cn/concepts/afs/) 建一个共享目录。但这两件事都是 **Workspace 级** 的配置——一个 Agent 要么对别人可见、要么不可见，共享目录要么挂着、要么不挂。

而很多协作其实是**任务级**的：

> "这次我想让我的私有 Agent 临时帮我做一份调研，做完就回到不可见。"
>
> "几个 Agent 共同往一个目录里写东西，做完归档；下次任务换一组成员、换一个目录。"

**Teamwork** 就是为这种场景准备的——你在首页的 **Teamwork** app 里创建一个 team task，把成员拉进来，平台自动管好可见性、共享目录、协作时间线。任务结束，全部收回。

## 多 Agent 协作的价值

要理解 Teamwork 的设计，先要理解多 Agent 协作究竟解决什么问题。

我们的看法是：**多 Agent 的本质是把 context 管好，让任务做得更稳**——不是为了在画布上画一堆五颜六色的 CEO/CTO 角色，那种把 Agent 拖成节点连线的玩法对最终任务的完成度没有真正帮助。

单 Agent 的 context 里通常塞着这些东西：

- 系统 prompt、加载的 skills、可用工具（**静态部分**——代表职责和知识）
- 用户消息、模型回复、工具调用的请求和结果（**动态部分**——本次对话累积下来的内容）

会撞到两个瓶颈：

1. **静态部分会膨胀**——一个 Agent 要既会做 PPT 又会改 Excel 又会查数据库，每多一项能力，系统 prompt 和 skills 就长一截。但任何一次对话其实只用得到其中一小部分，其余都是浪费。
2. **动态部分会变脏**——Agent 完成任务前往往要探索一番（列目录、读文件、试错），找到答案后那些过程内容就是"非必要"了，但它们已经以碎片形式占据了 context 空间，分散后续推理的注意力，而且很难剔除。

**Sub-agent 是怎么缓解这两点的**：

- **职责分离**——主 Agent 只负责拆分和调度，PPT 能力放在一个 sub-agent 里、Excel 在另一个 sub-agent 里。当前任务用得上谁就唤醒谁，用不上的能力不进主 Agent 的 context。
- **探索过程隔离**——sub-agent 在自己的 session 里探索、试错、读文件，那些 token 都待在 sub-session 里。主 Agent 只通过工具调用拿到 sub-agent 的**最终 result**（一段精炼的总结），sub-session 结束后探索过程就自然丢弃，不会污染主 context。

这是 Teamwork 想要利用的核心机制。所有的协作 UI、可见性配置、共享目录管理，都是为了让这件事在用户和 Agent 两个视角下都更顺畅。

## 已有的多 Agent 基础

Teamwork 不是从零起的。它建立在两个已有的能力之上：

### Agent 调用工具：`call_agent` / `get_agent_result`

主 Agent 通过这两个内置工具去调另一个 Agent：

- `call_agent`——发起调用。参数是目标 Agent 的 slug 和这次要交给它的任务描述（这段描述就是 sub-session 的第一条 user message——主 Agent 会从自己的上下文里提炼出与本次调用相关的部分作为参数）。支持**同步**和**异步**两种模式：同步会等 sub-agent 完成；异步可主动让长任务转入后台。无论同步异步，工具都会返回 sub-session 的 ID
- `get_agent_result`——用 sub-session ID 查询结果。可用于轮询异步任务，也可用于回看历史协作

`call_agent` 还支持**新开会话**或**继续之前的会话**——两个 Agent 之间也可以有多轮、多线程的对话，跟人和人协作类似。

### 文件级上下文：AFS 共享目录

对话能传文本，但传不了 PPT 二进制、PDF、几百行 CSV 这类东西。两个 Agent 默认的文件系统是隔离的——sub-agent 在自己容器里写好的文件，主 Agent 是读不到的。

[AFS](/zh-cn/concepts/afs/) 解决了这个问题：可以创建一个共享目录，挂载给多个 Agent；权限是只读还是读写都能控制，随时可以撤回。Agent 自己也能通过 MCP 工具发起共享。

Teamwork 用到的就是这套底层，只是把"建目录、挂载、回收"这件事自动化了。

## Teamwork 的三项增强

Teamwork 不是替代上面这两个能力，而是在它们之上加一层"**任务**"语义。在首页按 `⌘K` 打开 **Teamwork**（标记为预览版），创建一个 team task，设定一个 **协调员**（coordinator）Agent，再把成员加进来。从这一刻起，下面三件事就自动生效。

### 1. 任务级的 Agent 可见性

平时 Workspace 的 [Visibility](/zh-cn/guides/6-compose-agents/#visibility) 是三档：Private / User / Public。这是个 Workspace 级别的常态配置——一个 Agent 要么对协作方可见、要么不可见。

但如果你想要的是"这一次任务让某个私有 Agent 帮我做事，做完它继续不可见"——常态配置就太重了，得反复调来调去。

在 team task 里加成员时，候选列表包含：

- 所有 Public 可见的 Agent
- 所有 User 级可见的 Agent（你自己的）
- 你自己的 **Private** Agent——加进来时如果还没配 slug 可以在这里现配一个

把一个 Private Agent 加进 task 后，它**只在这个 task 里可见**，不影响其他场景。task 优先级**高于** Workspace 的全局可见性配置。所以你不必为了一次任务把 Agent 暴露到 user/public 级别。

### 2. 自动管理的共享目录

每个 team task 创建时都会自动创建一个共享目录（用任务 ID 命名，类似 `team-<uid>`），平台负责把它挂载给所有当前成员。

- 成员加入 → 自动挂上
- 成员退出 → 自动卸下
- 任务结束 → 共享目录回收

成员之间无须再走"建目录 → 授权"这两步——只要在 task 里，就有一个互通的工作目录可用。需要更细粒度控制（比如某两个 Agent 之间单独走一个临时目录）时，仍然可以手动用 AFS API 做，自动管理只是覆盖了绝大多数情况。

### 3. 协作时间线

前面说过，**复杂的多 Agent 调度画布对最终效果没有真正帮助**——但有一个观测视图是真正有用的：能看到 Agent 之间到底交换了什么 context。

team task 的详情页提供一个**协作时间线**：

- 每个成员的 session 是一条时间线（协调员在最上，sub-agent 依次往下）
- 每次 `call_agent` 在时间线上落一个点，标明：**主→次发出的 sub-message**、**次→主返回的 result**、调用是**同步还是异步**

不喜欢可以折叠掉。但在 debug 多 Agent 协作时这是最直接的工具——你能立刻看到主 Agent 究竟把什么传给了 sub-agent、sub-agent 又总结回来了什么，不必逐条翻对话记录。

## 典型场景

### 分头调研 + 主 Agent 合并

主 Agent 把任务拆给两个 sub-agent：一个调研竞品 ACME，一个调研竞品 Beta，分别把报告写到共享目录里。完成后主 Agent 读这两份文件，合并出一份总报告。

完整流程都在协作时间线里看得到：两次 `call_agent` 并行发出 → 两个 sub-agent 各自把 markdown 写到 `team-<uid>/ACME.md` 和 `team-<uid>/Beta.md` → 主 Agent 读两份后写出 `report.md`。

### 同一个 Agent 的多 session 并行

team task 里不一定要有多种 Agent。**同一个 Agent** 也可以开多个并行 session 各做一件事——前面说过，多 Agent 的本质是把 context 管好，单 Agent 的多 session 同样吃得到这个好处。

例：让一个 code-review Agent 开三个 session 并行检查同一段代码——一个看命名规范、一个看 SQL 安全、一个看前端错误处理。每个 session 都只装载这一个方向的 context，命中率比"一个 session 看所有方面"要高得多。

## 适用与不适用场景

**用 Teamwork**：

- 这次任务要拉**临时成员**（包括你的私有 Agent），完事就解散
- 成员之间需要**共享文件**，但不想手动管 AFS 目录
- 想观察 Agent 之间的 context 交换、debug 多 Agent 流程

**继续用普通 `@agent` 调用**：

- 长期固定的协作关系（比如 reviewer Agent 一直在被各个 dev Agent 调用）——配好 Visibility 和 Slug 就够，没必要每次开 task
- 简单一次性调用、不涉及文件交换

## 接下来

- 想知道 Agent 之间到底怎么互调、Visibility 怎么配 → [多 Agent 协作](/zh-cn/guides/6-compose-agents/)
- 想懂跨 Agent 文件共享底层 → [AFS：跨 Agent 文件共享](/zh-cn/concepts/afs/)
