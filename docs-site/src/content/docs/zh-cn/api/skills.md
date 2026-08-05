---
title: Agent Skills
description: nap-api skill —— 让本地 agent 学会用 NAP 自己的 API 驱动它
---

本地 agent 和托管 agent 是同一件手艺的两个尺度，API 就是这两者之间的接缝：你本地的 agent 可以创建托管 agent、把活交给它、再把结果读回来。前提是它得知道这套 API 怎么调。

`nap-api` 就是干这个的。它在仓库的 [`skills/`](https://github.com/neutree-ai/agent-platform/tree/main/skills) 下，是一个普通的 [Agent Skill](https://docs.claude.com/en/docs/agent-skills)——一个目录，里面一份 `SKILL.md`，agent 启动时读它。

## 里面是什么

从你实例吐出的同一份 OpenAPI 文档生成，按需读的结构拆好了：一份索引，然后每个资源一个文件，每个操作一个文件。agent 一路往下读到它要的那个操作，而不是把 150 个操作一次性塞进 context。

覆盖 workspace、prompt、模板、skill、凭证、service token、agent 文件、供应商、标签、共享、定时。

### 装到本地 agent 里

把目录拷进 agent 的 skills 目录——Claude Code 的话，自己用是 `~/.claude/skills/`，项目内是 `.claude/skills/`：

```bash
git clone https://github.com/neutree-ai/agent-platform.git
cp -r agent-platform/skills/nap-api ~/.claude/skills/
```

再把认证信息给它：

```bash
export NAP_BASE_URL=https://<你的 NAP 域名>
export NAP_TOKEN=<service-token>      # ⌘K → Service Tokens
```

之后直接用大白话说就行——"建一个跑 Codex 的 workspace，provider 用我那个 openai 的"、"列一下 workspace X 里 /work 下面的 agent 文件"。这个操作对应哪个 API，skill 会告诉它。

也可以把它传进 NAP 自己的 **Library**，让托管 agent 也有——一个 agent 能管别的 agent，就是这么来的。

### 把长任务交给云端 agent

skill 里带了一个驱动脚本，专治那个手写起来最烦的流程：发任务、轮询到这一轮结束、打印回复。

```bash
export NAP_TOKEN=<service-token>
export NAP_BASE_URL=https://<你的 NAP 域名>
export NAP_WS=<workspace-id>

./scripts/handoff.sh "把 TASK.md 里描述的东西实现掉"
./scripts/handoff.sh -s <session_id> "再补一下测试"      # 接着同一个 session
echo "很长的任务描述..." | ./scripts/handoff.sh -        # 从 stdin 读任务
```

发完就可以合上笔记本了，活在别的地方跑着。

## 保持最新

它是生成的，不要手改。对着一个在跑的 control plane 重新生成：

```bash
cd skills
CP_SPEC_URL=http://localhost:3000/api/docs/openapi.json npm run cp
```

重新生成会清空 skill 目录再重建，然后把 `assets/nap-api/` 里手写的文件覆盖回去——`handoff.sh` 放在那儿而不是 skill 目录里，就是这个原因。
