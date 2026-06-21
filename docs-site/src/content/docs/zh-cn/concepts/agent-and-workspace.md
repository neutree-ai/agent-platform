---
title: Workspace、Agent 与 Session
description: Neutree Agent Platform 里最常用的三个词，分别是什么
---

这三个词你会反复遇到，先把它们的边界理清，后面所有功能都会变得更好懂。

## Workspace 是 Agent 的工位

Workspace 是一个完整的"工作环境"，里面装着一个 Agent 工作所需的一切：

- **配置**——它用什么模型、什么 prompt、加载哪些 skills、连哪些 MCP
- **文件系统**——一个持久化的工作目录，Agent 在这里读写文件
- **终端**——一个可以执行命令的容器环境，Agent 在里面运行系统命令
- **对话记录**——所有 session 的历史
- **自动化规则**——定时任务、外部触发、自定义命令

**一个 Workspace 对应一个 Agent**。当我们说"创建一个 Agent"，本质上就是在创建一个 Workspace。

为什么不直接叫"Agent"？因为 Agent 这个词单独说时容易和"agent 引擎"（Claude Code / Codex）混淆。Workspace 强调的是**环境**——配置、状态、资源都在里面，不是一个悬空的 AI。

## Agent 是 Workspace 跑起来的样子

Workspace 创建后会自动启动。启动后跑起来的那个实例就是 Agent，它加载了 Workspace 的全部配置，等任务过来。

你在 Web UI 里点开 Workspace 看到的"对话框、文件浏览、终端"——都是这个运行中的 Agent 的不同侧面。

Workspace 可以**停止和重启**。停止后配置和文件都还在，只是没有进程在跑。重启后 Agent 又恢复工作。

## Session 是一次对话或任务

Session 是 Agent 工作的最小单位——一段有上下文的对话。一个 Workspace 可以同时跑多个 Session：

- Session A 处理代码 review
- Session B 做翻译
- Session C 调试 CI 失败

它们彼此独立，互不污染上下文。但**它们共享同一个 Workspace 的文件系统和终端**——A 下载的文件，B 也能看到。

每一种触发方式产生的也是一个 Session：你在 Web UI 新建一次对话、Schedule 到点触发、Slack 收到一条消息——结果都是 Workspace 里多了一个 Session。

## 这三层为什么这么分

把"配置"和"运行"分开，配置就可以快照、复制、做版本（这就是 Library 里的 Template）。把"运行"和"会话"分开，同一个 Agent 就能同时处理多个独立任务，不用每次重新启动。

理清这个层次，后面所有功能都能对号入座：改 prompt 是改 Workspace 的配置，调试一次具体的对话是看某个 Session 的历史，Schedule 到点触发其实就是建一个新 Session。
