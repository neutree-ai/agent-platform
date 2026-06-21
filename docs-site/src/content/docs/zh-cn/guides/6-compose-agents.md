---
title: 6. 多 Agent 协作
description: 让一个 Agent 调用另一个 Agent，组合出复杂能力
---

到这一步你已经能调好一个 Agent，并且能让它从多种渠道被触发。这一章讲一个新维度——**让 Agent 彼此调用**。

为什么要这么做？因为很多任务天然是多角色的：写完代码后让另一个 Agent 帮 review，做完翻译后让另一个 Agent 跑 QA，分诊请求后转给真正的专家。把这些角色拆成不同的 Agent 各自调好，再让它们组合起来工作，往往比训练一个"什么都会"的 Agent 更稳定、更易维护。

## 基本原理

Neutree Agent Platform（NAP）支持一个 Agent 在对话里**像调用工具一样调用另一个 Agent**。要让一个 Workspace 能被别人调用，需要做两件事：

1. 给它一个**可识别的 Slug**
2. 设置**可见性**

打开 **工作空间设置**，找到 Slug 和 Visibility 字段。

### Slug

Slug 是 Workspace 的唯一标识符，其他 Agent 通过它来引用。比如 `qa-checker`、`code-reviewer`、`translator`。

- 只允许小写字母、数字和连字符
- 留空则不可被其他 Agent 调用

### Visibility

| Visibility | 谁能调用 | 调用语法 |
|---|---|---|
| **Private** | 不可被调用 | — |
| **User** | 你自己的其他 Agent | `@agent/slug` |
| **Public** | 平台所有用户的 Agent | `@agent/username/slug` |

## 在对话里调用另一个 Agent

设好 Slug 和 Visibility 后，在调用方 Agent 的对话里这样写：

```
写完这个方案后，让 @agent/reviewer 帮我 review 一下
```

调用方 Agent 会自动完成跨 Workspace 通信：把上下文传过去，等被调用方返回结果，再整合到当前对话中继续工作。

也可以用**后台模式**——发出去之后不等待，让被调用方在自己的 Workspace 里慢慢做，做完通过通知或者写文件的方式告诉调用方。这适合耗时较长的任务。

需要把**大段资料**或**生成产物**在 Agent 之间传递时，不要塞到 prompt 里——用 [AFS（跨 Agent 文件共享）](/concepts/afs/)，把文件写到共享目录后授权给协作方，对方在自己的容器里以同一个路径直接读到。

## 几种典型协作模式

不同的业务场景对应不同的协作结构。下面是三种最常见的：

### 1. 分诊 → 专家

入口是一个**分诊 Agent**，它的 Prompt 很短，唯一职责是判断"这是哪类问题"，然后转给对应的专家 Agent。

```
你是一个分诊助手。用户的请求会落到三类之一：
- 翻译相关 → 转给 @agent/translator
- 代码问题 → 转给 @agent/code-helper
- 其他 → 转给 @agent/general

判断后用一句话说明你的判断，然后调用对应的 agent。
```

好处：每个专家 Agent 可以独立调优、独立换模型、独立维护知识。新增一类问题就加一个专家，不用改其他人。

### 2. 流水线

任务有固定的多步骤：A 做完交给 B，B 做完交给 C。每一步都是一个 Agent。

例：翻译流水线 ——
- `translator` ——做翻译
- `qa-checker` ——检查翻译质量
- `formatter` ——按目标格式输出

`translator` 完成后调用 `qa-checker`，QA 通过后再调用 `formatter`。任何一步出问题都能定位到具体的 Agent。

### 3. Planner + Worker

一个 **planner** Agent 负责拆任务、规划步骤，然后把每一步交给对应的 **worker** Agent 去做，最后汇总结果。

适合任务结构事先不确定的场景——planner 看完需求才知道要拆几步、调谁。

## Teamwork：任务级多 Agent 协作

上面讲的是**长期固定**的协作关系——A 给一个稳定的 Slug，B 长期可见、随时能调，目录也一直挂着。但很多协作其实是**一次性**的：

> "这次我想拉两个 Agent 帮我做一份调研，做完就解散。"
>
> "把我的私有 Agent 临时加进来用一次，不想把它永久升到 user/public 可见。"

这种场景 NAP 提供了 **Teamwork**（preview 阶段）。在「应用」里找到 Teamwork 入口，创建一个 team task：

1. **指定一个协调员（coordinator）Agent**——它是主 Agent，sub-agent 都由它发起调用
2. **添加成员**——候选列表包含所有 public / user 可见的 Agent，**还包含你自己的 private Agent**（如果还没配 slug 可以在这里现配）。private Agent 加进 task 后只在这个 task 里可见，不影响其他场景
3. **开始对话**——平台自动给这个 task 创建一个共享目录，挂给所有成员；成员加入/离开自动挂卸；task 结束自动回收

task 详情页有一个**协作时间线**：每个成员的 session 一条线，每次 `call_agent` 在线上落一个点，显示主→次的 sub-message、次→主的 result、调用是同步还是异步。debug 多 Agent 协作时非常直观。

**什么时候用 Teamwork、什么时候继续走普通 `@agent`：**

- 长期固定的协作 → 配 Slug + Visibility，本章上半部分讲的方式
- **一次性任务、需要临时拉私有 Agent、需要共享文件**——用 Teamwork

完整的设计动机和工作原理见 [Teamwork 概念页](/concepts/teamwork/)。

## 一些实践经验

**保持每个 Agent 的职责窄。** "什么都会"的 Agent 难以调优。一个 Agent 把一件事做好，比 5 个 Agent 各做半件强。

**Slug 命名要稳定。** 一旦其他 Agent 引用了你的 Slug，改名会导致引用方失效。命名时想清楚再定。

**先用 Private/User 试，再放 Public。** Public 会把 Agent 暴露给全平台，任何用户的 Agent 都能调用你。除非你确实想做一个公共能力，否则保守一点更好。

**调用关系不要套太深。** A 调 B 调 C 调 D 是可以的，但每多一层都多一倍延迟，也更难排查。三层以内是可控范围。

## 接下来

到这里 Agent 的"能力面"和"协作面"都有了。最后一章讲怎么把这些能力**复用、共享、规模化** —— [指南 7：规模化运营](/guides/7-operate-at-scale/)。
