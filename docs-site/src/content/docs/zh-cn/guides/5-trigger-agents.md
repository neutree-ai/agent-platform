---
title: 5. 触发 Agent
description: 让 Agent 在合适的时机自己开始工作——定时、外部事件、API
---

到这一步，你的 Agent 已经能在 Web UI 里手动对话工作了。这一章讲怎么让它**不靠人工就能开始工作**——按时间、按外部事件、按 API 调用。

三种触发方式的概念、边界和"为什么这么分"在 [Agent 从哪里接到任务](/concepts/triggers-and-routes/) 里讲过。这一章是动手版，按从易到难的顺序：

1. **定时任务** ——零外部依赖，最简单
2. **外部事件** ——通过 Slack、Webhook、企业微信接入外部系统
3. **API 触发** ——用 Service Token 让程序直接调用平台

## 定时任务

Workspace 顶部 **自动化** → **定时任务**，新建一个。需要填三件事：

- **名称** ——用于列表展示和日志识别（如 `daily-report`）
- **调度** ——cron 表达式
- **Prompt** ——每次触发时发给 Agent 的指令

cron 表达式的标准五段格式：`分 时 日 月 周`。

| 示例 | 含义 |
|---|---|
| `0 9 * * *` | 每天 9:00 |
| `0 9 * * 1-5` | 工作日 9:00 |
| `*/30 * * * *` | 每 30 分钟 |
| `0 0 1 * *` | 每月 1 号 0:00 |

时区默认跟随浏览器，可以单独设置。

### 注意事项

- **每次触发都是独立的 Session** ——不共享上下文。如果你需要"接着上次的状态继续做"，让 Agent 把状态写到文件里或者放进 [Memory](/guides/3-agent-behavior/#memory让-agent-记住)
- **最小间隔建议不低于 5 分钟** ——平台调度有缓冲，过短的间隔意义不大
- **禁用后保留配置** ——临时停掉一段时间不必删除

定时任务最适合：每天巡检一次系统状态、每小时拉一次新邮件做摘要、每周汇总数据。

## 外部事件：连接器 + 路由

外部系统（GitLab、GitHub、Jira、Slack、企业微信等）想主动叫 Agent 工作，需要两个对象配合：

- **连接器** ——接收事件的"门"。一个连接器对应一个外部系统的接入端点
- **路由** ——挂在连接器下面的规则。决定哪些事件交给哪个 Workspace 处理、怎么变成 Prompt

> 这两个对象的设计思路在 [概念页](/concepts/triggers-and-routes/#connector--route外部系统推送事件) 讲过——这里直接讲怎么配。

### Webhook：最通用的接入方式

绝大多数 SaaS 都支持 Webhook（GitLab、GitHub、PagerDuty、Jira、各种 CI 系统）。流程：

**第 1 步：创建 Webhook 连接器**

侧边栏 **集成 → 连接器** → 新建，类型选 **Webhook**。Webhook 连接器本身不需要额外凭证。

**第 2 步：创建路由**

侧边栏 **集成 → 路由** → 新建。配置：

- **连接器** ——刚才创建的那个
- **Endpoint Path** ——监听的 URL 路径（如 `/gitlab-ci`），和连接器组合成完整接收地址
- **Workspace** ——事件命中后由哪个 Workspace 处理
- **Secret** ——验签密钥。外部推送时携带相同密钥，平台验证后才处理。支持 Plain 和 HMAC-SHA256（GitHub 用后者）
- **Filter** ——过滤规则，只有满足全部条件的事件才会触发（详见下文）
- **Prompt 模板** ——把 HTTP 请求转成 Prompt 的模板，可用变量见下文

**Prompt 模板可用变量**：

| 变量 | 说明 |
|---|---|
| `{body}` | 完整请求体 |
| `{body.field}` | 请求体的嵌套字段 |
| `{query.key}` | URL query 参数 |
| `{headers.name}` | 请求头 |
| `{method}` | HTTP 方法 |
| `{path}` | 请求路径 |

留空则直接把原始请求体当 Prompt。

**第 3 步：在外部系统配置 Webhook**

把路由生成的完整 URL 填到外部系统的 Webhook 配置里，secret 也填一致。这一步的具体操作每个外部系统都不同，但 URL 和 secret 这两件事不会变。

### Filter：先过滤，省 token

Filter 在路由层做的过滤，**发生在创建 Session 之前**。不匹配的事件直接丢弃，不会启动 Agent，不消耗 token。

支持的操作符：

| 操作符 | 说明 |
|---|---|
| `=` | 精确匹配 |
| `≠` | 不等于 |
| `in` | 值在列表中（逗号分隔） |
| `exists` | 字段是否存在 |

举个例子：GitLab 推过来的 CI 事件，只想处理失败的 job：

```
body.build_status = failed
body.tag = false
body.build_name ≠ sonarqube-check
```

三条规则都满足才触发，否则直接丢掉这个事件。

> **不要把固定过滤条件交给 Agent 判断**。过滤条件能写成规则的，就放在 Filter 里——免得每次都开一个 Session 加载上下文，只为了"看一眼再决定不做"。Agent prompt 应该只处理需要语义理解的复杂判断（比如"如果同样的问题前一次已经回复过，就不重复回")。

### Slack 接入

Slack 的接入流程类似，但凭证更复杂一些——需要先在 Slack 创建一个 App，开启 Socket Mode，拿两个 token：

- **Bot Token**（`xoxb-...`） ——OAuth & Permissions 页
- **App Token**（`xapp-...`） ——Basic Information 页，scope 为 `connections:write`

Bot Token 需要的 scope：`chat:write`、`channels:history`、`channels:read`、`app_mentions:read`。

填好 token 创建 Slack 连接器后，给它挂路由——选监听的 channel（仅列出 bot 已加入的）和目标 Workspace。

Slack 路由额外支持 thread 内多轮对话：同一个 thread 里的连续消息会复用同一个 Session，TTL 默认 24 小时。Prompt 模板的可用变量比 Webhook 多了 `{message}`、`{user}`、`{thread_context}`、`{channel}`。

### 企业微信接入

如果团队用企业微信，可以接入企业微信智能机器人，让群里 @机器人 直接触发 Agent。

需要在企业微信管理后台创建一个 **智能机器人**（不是自建应用），拿到 **Bot ID** 和 **Secret**，填到企业微信连接器里。

注意事项：被动回复有 24 小时窗口、有频率限制（30 条/分），不适合高频场景。

## API 触发：Service Token

如果你想让程序直接调用 Agent，比如 CI 流水线里、自动化脚本里、自己写的小工具里，可以用 **Service Token**。

侧边栏 **集成 → 服务令牌** → 新建。Token 创建后**只显示一次**，立刻保存。

之后在 HTTP 请求的 `Authorization` header 里带上：

```
Authorization: Bearer <token>
```

具体能调哪些接口、URL 是什么，[API 文档](https://nap.neutree.ai/api/docs) 里有完整列表。

## 一张速查表

| 想做的事 | 用什么 |
|---|---|
| 每天/每小时定时跑 | 定时任务 |
| 外部 SaaS 出事件时跑 | Webhook 连接器 + 路由 |
| Slack 群里 @机器人 触发 | Slack 连接器 + 路由 |
| 企业微信群里 @机器人 触发 | 企业微信连接器 + 路由 |
| 程序代码里调用 | Service Token + REST API |

## 接下来

让 Agent 之间互相协作 → [指南 6：多 Agent 协作](/guides/6-compose-agents/)。
