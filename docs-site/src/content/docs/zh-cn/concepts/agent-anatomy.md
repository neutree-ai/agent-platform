---
title: Agent 的组成
description: Model、Prompt、Skills、MCP、Memory 各自负责什么
---

调一个 Agent 的行为，有五件东西可以动。这五件不在同一个层次——先把层次理清，后面写 prompt 和挑工具都会更顺手。

## Model：Agent 的大脑

Model 决定 Agent 有多聪明、风格如何、贵不贵。同一个 prompt、同一组 skills，换个模型表现可能差很多。

Neutree Agent Platform 不绑定特定厂商。你通过 **Provider** 把模型 API 接进平台——可以是团队统一采购的 API 网关、你自己的 Anthropic / OpenAI key、OpenRouter、Azure OpenAI，或其他兼容端点 —— [协议类型必须和 agent 对得上](/zh-cn/guides/1-setup/)，对应关系见该页。一个 Agent 选一个 Provider 和一个具体模型。

进阶：你还可以为 Agent 配一个 **Small Model**——用于文件搜索、代码索引这些轻量内部操作，省钱。Agent 自己决定什么时候用大脑、什么时候用小脑。

## Prompt：身份和做事方式

System Prompt 是 Agent 最重要的配置。它告诉 Agent **你是谁、你怎么干**——角色定义、做事步骤、输出格式、安全约束。

Prompt 可以直接写在 Workspace 里，也可以从 **Prompt Library** 引用一份共享的。用引用的方式时，Prompt 一旦更新，所有引用它的 Agent 自动同步——这是规模化运营的基础。

写好 prompt 本身是个不小的话题，[定义 Agent 行为](/zh-cn/guides/3-agent-behavior/)单独讲怎么写。

## Skills：可复用的子流程

Skill 是一个**封装好的"做某类事情的方法"**——一个目录，里面有一份 `SKILL.md` 描述文件加若干工具脚本。启用 skill 后，文件被挂载进 Agent 的容器，Agent 启动时自动读取 `SKILL.md`，知道有这个能力可用。

举几个例子：把一组调用 GitLab API 的常用操作封装成 `gitlab-api` skill；把"诊断某类内部服务故障的标准排查步骤"封装成一个 skill，需要时一键启用；把对接某个第三方 SaaS 的认证和调用细节封装成 skill，避免每次让 agent 重新摸索。

Skill 适合的场景：**这件事有相对固定的步骤或知识，但又不值得让所有 Agent 默认都加载**。需要时勾选启用即可。Skills 在 **Library** 中统一管理，支持上传压缩包或从 Git 仓库导入，所有 Agent 共享。

## MCP：外部工具的入口

MCP（Model Context Protocol）是一个标准化的协议，让 Agent 调用**外部服务**的能力。你给 Agent 配置一个 MCP Server 的连接信息（命令或 URL），Agent 启动时连上去，那个 server 暴露的所有工具就成了 Agent 可调用的 tool。

MCP 和 Skill 经常有人分不清，区别是：

- **Skill** 是文件挂载到容器里，Agent 自己读、自己执行——适合"流程性、知识性"的能力
- **MCP** 是协议层调用外部服务——适合"接外部系统、跨网络、有自己的状态"的能力

举例：一份"按规范查询某类知识库"的指引（文件形式即可）做成 Skill 合适；一个独立运行、有自己 API 和数据的服务（比如 Grafana）做成 MCP 合适。

## Memory：跨 Session 的长期记忆

默认情况下，每个 Session 是独立的——上一次对话里 Agent 学到的东西，下次对话不会自动记得。Memory 解决这个问题。

Neutree Agent Platform 的 Memory 形态是**记忆库（Memory Store）**——一个独立的资源，可以挂给一个或多个 Workspace。每个库里是多条带版本的记录，分为 user / feedback / project / reference 四类。对 Agent 来说，记忆库以**文件目录**形式挂载在容器里（`/mnt/memory/<store>/`），可以用 grep、bash pipe、按需读取等熟悉的方式操作。

"用户偏好用中文"、"这个项目的代码风格是 X"、"上次踩过的坑"——这些适合放在 Memory，不适合每次都让用户重述。Agent 自己也能写记忆库（通过平台内置工具）。

完整的概念和工作原理见 [记忆库（Memory Store）](/zh-cn/concepts/memory-store/)。

## 五件套的搭配方式

- **Model** 是底座，定调子
- **Prompt** 是契约，决定 Agent 的人格和工作框架
- **Skills** 是按需加载的"特长"
- **MCP** 是"接到外部世界"的桥
- **Memory** 是 Agent 自己积累的经验

一般顺序：先选好 Model、写好 Prompt 跑通最简单的版本，然后按需加 Skills 和 MCP 扩展能力，最后用 Memory 让它越用越懂你。
