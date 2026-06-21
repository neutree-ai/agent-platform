---
title: 4. 扩展 Workspace
description: 自定义命令、Sandbox、MCP 服务和自定义 UI 标签
---

[指南 3](/guides/3-agent-behavior/) 讲的是用现成手段调教单个 Agent。这一章往外走一步——**扩大 Agent 的活动范围**，给它接上原本没有的工具和能力。

由浅入深四件事：

1. **自定义命令** ——把常用提示词封装成一键触发的快捷指令
2. **Sandbox** ——Agent 跑代码用的临时隔离容器（这一节是科普性的，帮你理解产品里看到的"沙箱"面板）
3. **MCP 服务** ——给 Agent 接一个独立运行的工具服务
4. **自定义 UI 标签** ——把业务系统的界面嵌进 Workspace（工程团队的话题）

可以按需要往下读，越往下越偏工程。

## 自定义命令

如果你发现自己反复发同一类提示词给 Agent，就该把它做成命令。打开 Workspace 顶部的 **自动化** → **命令**，新建一个，命令名形如 `/review`。

### 命令类型

- **Plain** ——固定文本，触发后直接发给 Agent
- **Struct** ——带变量的模板，触发时弹表单让你填值

Struct 模板用双花括号定义变量：

```
请帮我 review 仓库 {{REPO}} 的 {{BRANCH}} 分支上最近一次提交。
重点关注：{{FOCUS}}
```

在对话框里输入 `/review` 触发时，会弹出 `REPO`、`BRANCH`、`FOCUS` 三个输入框，填好后作为这次对话的初始消息发出去。

### 命令的内容来源

- **Custom** ——直接在配置里写
- **资源库 Prompt** ——从资源库引用一份共享的 Prompt。Prompt 更新时所有引用方自动同步

后者适合多个 Agent 共用同一套命令。

## Sandbox：Agent 跑代码的临时容器

Workspace 自带的运行环境（**文件 / 终端**）足够 Agent 做日常的文件操作和命令调用，但当 Agent 需要**真的跑一段代码**——执行一个 Python 脚本验证想法、跑一段 SQL 看结果、临时编译一个工具——它需要一个干净、隔离、可以随时丢弃的环境。这就是 **Sandbox**。

Sandbox 不是 Workspace 自身的运行环境，而是 Agent **按需创建的另一个容器**。每个 sandbox 有自己独立的镜像、CPU、内存和超时时间，用完即销毁，不会污染 Workspace 的文件系统。

### 谁来创建 sandbox

平台内置了一组 MCP 工具暴露给 Agent，让它可以自主管理 sandbox：

- `create_sandbox` ——按需创建一个
- `sandbox_run_command` ——在里面执行命令
- `sandbox_read_file` / `sandbox_write_files` ——读写 sandbox 内的文件
- `kill_sandbox` ——用完销毁

也就是说，Agent 想"跑一段代码看结果"时，它会自己调用这些工具——你不需要做任何配置。**Sandbox 是开箱即用的能力，不是需要你启用的扩展。**

### 你能在哪里看到它

Workspace 里有一个 **沙箱** 面板，列出当前活跃的所有 sandbox：每个的镜像、资源、剩余存活时间。你也可以从这里手动创建一个 sandbox 用于调试——填镜像地址、CPU、内存、超时时间，确认即可。

### 镜像选择

每次创建 sandbox 时都需要选一个 Docker 镜像。平台预热了两个常见的，秒级启动：

- `node:22-bookworm` ——Node.js 环境
- `python:3.12-bookworm` ——Python 环境

也可以填**任意 Docker 镜像地址**——首次启动需要拉取，之后会被缓存。如果团队有自己的标准镜像（预装某些工具或内部 CLI），可以放在 registry 里供 Agent / 用户使用。

### 这一节你需要记住的

1. Workspace 自身的运行环境是**固定**的，无法更换镜像
2. Agent 需要跑代码时，会通过 MCP 工具创建一个 **sandbox**——按任务选镜像、用完就丢
3. 你不需要额外配置 sandbox，它是平台自带能力
4. 想看 Agent 当前在跑哪些 sandbox，去 Workspace 的 **沙箱** 面板

## MCP 服务

MCP（Model Context Protocol）是一个标准化的协议，让 Agent 调用**独立运行的服务**所提供的工具。和 Skills 的区别在 [Agent 的组成](/concepts/agent-anatomy/) 里讲过：Skills 是文件挂载到容器、Agent 自读自用；MCP 是协议层调用外部服务，适合"接外部系统、跨网络、有自己的状态"。

### 接入一个现成的 MCP 服务

如果团队已经部署好了一个 MCP 服务，接入只需要在 Agent 配置里填几行：

打开 **Agent 配置** → **设置**，找到 **MCP 配置** 区域。配置格式：

```json
{
  "mcpServers": {
    "my-service": {
      "type": "http",
      "url": "http://my-service.internal/mcp"
    }
  }
}
```

支持两种传输：

| 类型 | 适用场景 |
|---|---|
| `http` | 远程 HTTP Streamable 服务 |
| `stdio` | 本地进程，需要 `command` + `args` 字段 |

保存后 Agent 重启，启动时会自动连上，那个服务暴露的所有工具就成了 Agent 可调用的能力。

### 部署你自己的 MCP 服务

如果你需要给 Agent 一个全新的能力，而且这个能力**有自己的数据、状态或后台进程**，那就值得做成 MCP 服务。

写一个 MCP 服务本质上是写一个普通后端服务，按 [MCP 规范](https://modelcontextprotocol.io) 暴露 tool 接口。常见做法是用官方 SDK：

- TypeScript ——`@modelcontextprotocol/sdk`
- Python ——`mcp`

部署之后把它的 URL 填进 Agent 配置，Agent 就能用了。具体的部署细节属于工程话题，超出了本指南的范围——团队里有工程师的话，建议直接和他们对接。

## 自定义 UI 标签（Mini SaaS）

> 这一节是工程团队的话题。不写代码的用户可以跳过。

Workspace 顶部的 tab 栏（**文件 / 终端** 等）是可以扩展的——你可以把一个独立的 web 界面注册成 Workspace 的一个 tab，Agent 干活的同时，用户能直接看到相关业务的实时状态。

这种集成模式叫做 **Mini SaaS** ——一个独立部署的微服务，通过三个标准化通道集成回平台：

- **管理 UI** ——独立的管理界面，维护领域数据（如术语库、规则集、知识库）
- **MCP 服务** ——供 Agent 调用的工具接口
- **UI 标签** ——嵌入 Workspace 的自定义面板

如果你的业务场景需要这种深度集成，建议联系 Neutree Agent Platform 团队沟通方案。

## 接下来

到这里 Agent 的"能力面"已经有了完整的扩展手段。下一章讲怎么让 Agent **不止靠人工对话触发** —— [指南 5：触发 Agent](/guides/5-trigger-agents/)。
