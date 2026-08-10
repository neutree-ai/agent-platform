---
title: REST API
description: 用自己的代码调 NAP —— Service Token 认证，以及交互式参考在哪里
---

Web UI 做的每一件事都走同一套 REST API，你自己的代码只需要一个 **Service Token** 就能用同一套。CI 里开一个 workspace、脚本批量导 prompt、本地 agent 把长任务甩给云端的——都是这一个面。

## 交互式参考在你自己的实例上

你自己那套 NAP 就在 serve 它：

```
https://<你的 NAP 域名>/api/docs
```

登录状态下 `⌘K` → **API 文档** 直接过去。机器可读的文档在旁边：`/api/docs/openapi.json`。

这里没有镜像一份，是有意的：你的实例吐出来的那份是从你真正在跑的那个 control plane 生成的，版本和你手里的对得上，而不是和我们的对得上。

## 认证

在 UI 里建 token —— `⌘K` → **Service Tokens**（路由 `/integration/tokens`）→ **创建**。token **只显示一次**，当场复制。

每个请求都带上它：

```
Authorization: Bearer <token>
```

## Base URL 与约定

路径都相对于你的域名，所以列 workspace 是 `GET $NAP_BASE_URL/api/workspaces`。

有一条约定值得先知道，否则一定会踩：**带路径的 query 参数要整体 URL-encode**。整个值一起编码，里面的斜杠是字面量不是分隔符。原样传中文或带斜杠的值，要么 400，要么路由到别处去。

## 最常用的那一个调用

对 service token 来说，**故意没有 exec 端点**。活儿是以 prompt 的形式交给 agent 的，而 agent 背后是它的全套工具——bash、改文件，和它在 UI 里能用的一样：

```bash
BASE="${NAP_BASE_URL:?}"
NAP_WS="<workspace-id>"

# 发起一轮。async 立刻返回 202 和一个 session id。
SID=$(curl -s -X POST "$BASE/api/workspaces/$NAP_WS/chat" \
  -H "Authorization: Bearer $NAP_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"列一下仓库里的文件，总结 README","mode":"async","source":"api"}' \
  | jq -r .session_id)

# 然后轮询这个 session 直到 agent 跑完，再读对话记录。
```

也可以流式返回，想盯着它干活而不是等结果的话。

不在你第一直觉那个位置的几件事：

| 你想 | 去哪 |
|---|---|
| 让 agent 干活——跑任务、改文件、回答它做过什么 | `POST /api/workspaces/{id}/chat` |
| 读写、列 workspace 里的文件 | `agent-files` 资源 |
| 访问共享的 `/mnt/afs` 卷 | `agent-afs-files` 资源——是另一个挂载点 |
| 建 workspace 并配置它 | `POST /api/workspaces`，然后 `PUT /api/workspaces/{id}/config` |
| 批量管 prompt / 模板 / skill | `prompts`、`templates`、`skills` 资源 |

## 接下来

与其自己读操作列表，不如把它交给 agent：[nap-api skill](/zh-cn/api/skills/) 就是从同一份 spec 生成的，本地 agent 靠它来驱动 NAP。
