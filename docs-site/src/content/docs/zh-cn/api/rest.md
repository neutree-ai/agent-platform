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

# 轮询到 session 真正结束：没有 turn 在跑，也没有还没返回的 agent 调用。
while :; do
  S=$(curl -s "$BASE/api/workspaces/$NAP_WS/sessions/$SID" -H "Authorization: Bearer $NAP_TOKEN")
  [ "$(echo "$S" | jq -r .chat_status)" != "agent" ] \
    && [ "$(echo "$S" | jq -r '.pending_agent_calls // 0')" = "0" ] && break
  sleep 3
done

# 再读对话记录。
curl -s "$BASE/api/workspaces/$NAP_WS/messages?session_id=$SID" \
  -H "Authorization: Bearer $NAP_TOKEN" | jq .
```

也可以流式返回，想盯着它干活而不是等结果的话。

### session 什么时候算结束

`chat_status` 不是 `agent`，**并且** `pending_agent_calls` 是 `0`，才算结束。后一半容易漏。

一次请求只发起一轮，但 session 里跑的轮数可能比你发起的多。agent [把活交给别的 agent](/zh-cn/guides/6-compose-agents/) 之后，可以不等对方做完就先结束这一轮，这时它的回复只是一句"已经派出去了，在等"。对方做完，平台把结果投回这个 session，agent 自己再跑一轮。两轮之间，session 的 `chat_status` 是 `idle`，`pending_agent_calls` 大于 0，最后一条回复还不是答案。

| 模式 | 怎么做 |
|---|---|
| `async` | 轮询 `GET /api/workspaces/{id}/sessions/{sessionId}`，两个条件都满足才停，就是上面那个循环。 |
| `sync` | 响应里也带 `pending_agent_calls`。是 `0`，`final_message` 就是答案；大于 `0`，那只是中间回复，接着轮询 session，结束后再读消息。 |
| `stream` | 流在第一轮结束时关闭。之后查一次 session，还有调用没返回就接着轮询。 |

投回来的结果在对话记录里是 `user` 消息，整条包在 `<agent-sys>…</agent-sys>` 里，第一行以 `[Automated delivery of call_agent results` 开头。它不是谁打的字，答案看最后一条 `assistant` 消息。

只有 `source` 为 `api` 或 `web` 的 session 会收到投回的结果。定时任务和 IM 渠道发起的 session 里，agent 在同一轮内等调用返回，`pending_agent_calls` 一直是 `0`。

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
