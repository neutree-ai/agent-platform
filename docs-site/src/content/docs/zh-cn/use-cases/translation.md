---
title: 产品文档翻译
description: 文档团队使用 Neutree Agent Platform 翻译产品 UI 和对外文档
---

> 文档团队用 Neutree Agent Platform（NAP）翻译产品 UI 和对外文档，替代 Crowdin 这类传统翻译平台，流程更灵活、更快。

## 前置条件

- GitLab 仓库访问权限（存放待翻译的源文件）
- Slack Connector（接收团队临时翻译需求）
- 翻译相关 MCP Server 已部署：Translation Review、Translation Memory（TM）、Glossary、QA Rule

## 如何触发

在 NAP Web UI 的 Chat 里发起翻译任务。翻译团队用大白话描述需求，比如：

- "翻译 xx 仓库最近一次提交的增量内容"
- "从 Slack #translation-requests 频道拉今天的翻译需求"

## Workspace 配置

| 配置项 | 值 |
| --- | --- |
| Agent Core | Codex（从 Claude Code 无缝切换，见下方说明） |
| Model | GPT |
| MCP Servers | Translation Review, Translation Memory, Glossary, QA Rule |
| Skills | Slack API |

### 换 Agent Core 不改流程

项目早期用的是 Claude Code + Claude 模型。有一次底层模型 API 挂了，团队把 Agent Core 换成 Codex + GPT，翻译流程继续跑，prompt 和工作流配置一个字没动。因为 NAP 把 Agent Core 和 Model 分开，业务就不用绑死在一家供应商身上。

## 完整流程

一次典型的翻译任务：

1. **发起** — 翻译团队在 Chat 里描述翻译需求
2. **拉取** — Agent 从 GitLab 仓库拉源文件，识别增量；或者通过 Slack API 拉临时翻译需求
3. **翻译** — Agent 查 TM 复用已有翻译，参考 Glossary 统一术语，然后翻译
4. **质检** — QA Rule MCP 自动检查翻译质量（格式、术语、用词一致性等）
5. **审批** — 翻译结果进入 Review Tab，团队在专门的审批界面逐条过
6. **提交** — 审批通过，Agent 把翻译结果提交回仓库

## 几个关键点

### 专门的翻译审批界面

Workspace 的 Review Tab 接近专业翻译软件的审批流程：

- **逐行对照**：源文和译文并排展示，支持 JSON 文件的 key-value 逐行对齐
- **内联编辑**：直接在审批界面改译文，不用回 Chat
- **术语高亮**：自动识别并高亮 Glossary 里的术语，悬浮提示术语释义和用法
- **状态追踪**：每条翻译标记为 Approved / Edited / Rejected，进度条实时显示整体审批进度
- **Reject 必填原因**：点 Reject 时必须写原因

### 四个 MCP Server 各管一段

| MCP Server | 作用 |
| --- | --- |
| Translation Review | 管翻译审批流程，chunk 级别的状态流转 |
| Translation Memory | 复用历史翻译，统一用词，减少重复劳动 |
| Glossary | 术语管理和校验，专业术语翻译统一 |
| QA Rule | 自动化质量检查，抓格式错误和术语误用 |

### 文档团队也能自己写 CI

文档团队（非开发）用 NAP 写和维护 CI 脚本，比如从翻译仓库内容提取 TM 回写的自动化流程——这在没有 NAP 之前是做不到的。

### 团队配置靠模板和 Prompt Library 统一

翻译团队用 NAP 的模板和 Prompt Library 持续迭代翻译流程。团队所有成员的 Agent 一键同步，配置保持一致。

## 局限与注意事项

*暂无已知局限。*
