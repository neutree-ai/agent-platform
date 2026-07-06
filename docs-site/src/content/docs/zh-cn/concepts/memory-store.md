---
title: 记忆库（Memory Store）
description: 跨 Workspace 复用的结构化记忆系统，对 Agent 以文件形式暴露
---

每个 Agent 的 session 默认是相互独立的——上一次对话学到的东西，下一次不会自动记得。Neutree Agent Platform（NAP）用**记忆库（Memory Store）** 解决这个问题：你或 Agent 写进去的内容，会随后续每一次 session 进入 Agent 的工作上下文。

记忆库是新版本（替代了早期"每个 Workspace 一份单一 Markdown"的简单 Memory），它带来了几个能力：

- 一个 Workspace 可以挂多个记忆库；一个记忆库也可以挂给多个 Workspace
- 库里是**多条记录**，每条带**版本**，可追溯可回滚
- 每条记录有**类型**（user / feedback / project / reference）
- 对 Agent 暴露为**普通文件**，能用 grep、bash pipe、按需读取

## 为什么不再用单一 Markdown

旧版的痛点很具体：

- **读不动**——Agent 每次要读记忆都得全量读出来，长 session 跑久了内容很长，但跟当前对话相关的可能就一小段
- **写不准**——只有"全量替换 / 追加"两个语义。想改其中一小段，要么重写全文（耗 token、易丢失），要么追加（越来越乱）
- **没结构**——所有内容混在一份文档里。Agent 想给不同类型的任务记不同的事，最后都汇到一处，难维护

新版的设计目标就是把这三件事解开。

## 记忆库的结构

### 库与 Workspace 的解耦关系

在首页打开 **记忆库** app（`⌘K` → **记忆库**）。左侧列表是当前账号下的所有记忆库。

- 新建 Workspace 时，系统会自动创建一个同名记忆库并挂给它——所以默认情况下你看到的就是"一一对应"
- 但**关系是解耦的**：你可以新建一个库，手动挂给一个或多个 Workspace；也可以把同一个库挂给多个 Workspace 共享

> 这次新版上线时做了一次迁移——旧版每个 Workspace 的单条 Memory 内容会迁到对应的同名记忆库里。

这带来两个实用的分层模式：

- **用户级共享记忆库**——记"我"的偏好（用什么语言对话、偏好的风格），挂给自己所有 Workspace
- **Workspace 专属记忆库**——记当前 Agent 的项目知识，只挂给一个 Workspace
- **跨 Workspace 临时共享**——两个 Workspace 协同做一件事时，临时挂同一份记忆

### 多条记忆与版本管理

打开任意一个库，看到的是一个**列表**——每条记忆是一条独立的记录。

每次写入记忆，平台都会保留**版本快照**。你可以查看历史版本、回滚到任意一版——和 Git 的语义类似，让记忆从"一团黑盒文档"变成看得见、回得去的东西。

### 记忆类型

新建一条记忆时，必须从这四个类型里选一个，**不能自定义**：

| 类型 | 倾向 | 例子 |
|---|---|---|
| **user** | 整个用户全局的个性 / 偏好 / 倾向 | "我倾向用葡萄牙语对话"、"代码风格偏 PEP 8" |
| **feedback** | 当前对话里的即时反馈 | "回复时简洁一点"、"不要中英混杂" |
| **project** | 围绕任务的项目级知识 | "这个项目用 PostgreSQL，主表在 `app_user` 库下"、"上次直接 DROP TABLE 翻车过" |
| **reference** | 外部引用 | "回答这类问题之前先读 https://internal-wiki/foo" |

> 这套分类参考了 Claude 的官方记忆系统（Claude Code 和它的托管 Agent 都用同一组类型）。我们目前没有足够的量化数据来证明这是最优分类，但选择跟随一个已经被大规模验证的方案，比自己拍脑袋设计更稳。后续会根据使用数据扩展。

## 文件形式的暴露

这是新版最关键的设计决定：**记忆库在 Agent 容器里以文件形式暴露**，挂载在 `/mnt/memory/<store-name>/` 下。

也就是说——Agent 读写记忆，用的不是某个特殊 API，就是**普通的文件操作**：

```bash
# Agent 视角
ls /mnt/memory/
cat /mnt/memory/user-prefs/language.md
grep -r "DROP TABLE" /mnt/memory/
echo "新的偏好" >> /mnt/memory/user-prefs/notes.md
```

为什么这么做？因为 LLM 对文件读写有非常深的**原生 affordance**：它会用 `cat`、`grep`、`head`、`tail`、`sed`、bash pipe 这一整套工具按需高效读写。任何自定义的 API 都得另写一段 prompt 教 Agent 怎么用，效率不如直接复用它已经会的文件语义。

特别是**写入**——通过 pipe 直接合并多个文件到记忆，Agent 一次 bash 调用就能完成，不需要把内容作为 token 输出再粘贴。这是 MCP 工具至今难以匹配的效率。

### `MEMORY.md` 索引文件

每个库的根目录下，`MEMORY.md`（大写）是一个**特殊的索引文件**：

- 由 Agent 自主维护——每次新增/修改/删除记忆条目时，Agent 会同步更新这份索引
- 它会被平台**直接内联进 Agent 的系统 prompt**

因此 Agent 一启动就能从系统 prompt 里看到：当前挂了哪些库、每个库的大纲是什么。具体某一条记忆的完整内容仍在子文件里，Agent 看到大纲后**按需**读取——这是新版高效读取的核心。

打个比方：`MEMORY.md` 是图书馆门口的索引牌，子文件是书架上的书。Agent 进门就知道有哪些书、各自讲什么，要看哪本再走过去翻。

## 平台 Prompt 层

为了让记忆库这种机制生效，NAP 在你写的 system prompt 之外还会**注入一层「平台 prompt」**。这层 prompt 是平台自动维护的，会动态拼接：

- Agent 类型、注册的内置 skills（比如 `platform` skill）的引用说明
- **当前挂载的所有记忆库的名字 + 每个库的 `MEMORY.md` 索引内容**
- 一些常驻的工具使用建议

所以 Agent 启动时就能"看见"它有哪些记忆可用、各自的大纲、要深入读时去哪里——不需要用户在自己的 prompt 里手写引导。

你自己写的 system prompt 仍然完全有效，平台 prompt 只是叠加在上面的一层公共上下文。

## 工作原理

> 这一节是给好奇底层的同学准备的，不影响使用。

记忆库的**真源是数据库**——库、记录、版本、`(workspace, store)` 挂载关系都是 control plane 数据库里的表。这样后台才能做批量整理、跨 Workspace 的索引、未来的"持续记忆整理"功能。

但 Agent 看到的是文件。这中间的桥是给每个 Agent pod 注入的一个 sidecar 容器——`memory-fuse`：

```
┌─────────────────────────┐    ┌──────────────────────┐
│  Agent 容器              │    │ memory-fuse sidecar   │
│   读写                   │    │                       │
│  /mnt/memory/<store>/   │◄──►│  FUSE 挂载点          │
│                          │    │  ↕                    │
└─────────────────────────┘    │  本地缓存（文件副本）  │
                                │  ↕                    │
                                │  control plane API    │
                                └────────────┬──────────┘
                                             ↓
                                          DB（库/记录/版本）
```

- **挂载时**——sidecar 启动或收到 `mount/umount` 信号时，从 control plane 拉这个 Workspace 挂了哪些库、库里有哪些记忆，把内容写到本地缓存目录
- **Agent 读**——FUSE 劫持读请求，命中本地缓存就直接返回；不会每次都打 DB（grep 一类操作可能同时命中很多文件，每次回源 DB 性能会很差）
- **Agent 写**——FUSE 劫持写请求，翻译成对应的 control plane API 调用（create / update / delete），最终落 DB；同时刷新本地缓存让后续读看到一致状态

为什么不用 MCP 工具暴露记忆？两个原因：

1. **读的灵活性**——LLM 已经会用 `grep`、`head`、`tail`、按行读、按片段读这些文件操作。一套自定义 MCP 读接口要重复实现这些语义，还要花 prompt 教 Agent 用
2. **写的 pipe 能力**——文件系统支持 `cat a.md b.md | tee /mnt/memory/x.md` 这种连贯操作，Agent 不需要把内容回流到 token 里再输出。MCP 目前还没有等价的 pipe 语义

> 这套机制也跟 Claude 的托管 Agent 高度一致——根据外部分析和实测来看，他们也是用类似的 sidecar + FUSE 方案让记忆"看起来像文件"。

## 使用建议

**让 Agent 自己整理记忆**——尤其是从旧版迁移上来的库，第一条记录通常是一整段陈年笔记。直接对 Agent 说"按最佳实践重新整理一下这个记忆库"，它会自己拆分、归类、维护索引。

**写好 `MEMORY.md`**——索引越清晰，Agent 按需读取的命中率越高。每条记忆在索引里有一两句话的简介足够，正文留给子文件。

**分层挂载**——账号级偏好（语言、风格）放一个独立的"用户记忆库"，挂给所有 Workspace；项目知识放 Workspace 专属库。别把所有东西塞一个库里。

**敏感信息不要进记忆库**——API key、密码请用 [凭证](/zh-cn/guides/1-setup/#凭证agent-访问资源的钥匙)。记忆库本质是 Agent 上下文，会进对话，不适合放秘密。

## 接下来

- 实操：挂记忆库、写第一条记忆 → [定义 Agent 行为](/zh-cn/guides/3-agent-behavior/#memory跨-session-的记忆)
- 这套机制和 Agent 五件套的关系 → [Agent 的组成](/zh-cn/concepts/agent-anatomy/#memory跨-session-的长期记忆)
