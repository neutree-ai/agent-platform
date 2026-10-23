---
title: 8. 在 NAP 上做应用
description: App Spec——让你自己产品的每个用户都有一组 Agent，写一次声明，NAP 负责让它们跟上
---

前 7 章讲的是人在 NAP 里用的 Agent。这一章讲长在**你自己产品**里的 Agent：产品的每个用户都有一组自己的 Agent。比如一项服务给每个客户配一个助手，一个团队工具给每个成员配一个调研 Agent 和一个写作 Agent，或者每个用户有一个只处理自己文件的 Agent。

你的应用原有的东西都不动：登录、页面、数据、业务规则还是它自己的。Agent 交给 NAP 来跑。两边靠一份文档对接，叫 **App Spec**：每个用户有哪些 Agent，各用什么模型、Prompt、Skill 和工具。应用在部署时 apply 它，NAP 按它给每个用户建 Workspace，它一改，所有 Workspace 跟着改。

## 各部分怎么对上

<pre class="mermaid">
flowchart LR
  subgraph APP["你的应用"]
    DEPLOY["部署步骤"]
    BACKEND["后端<br/>登录、对话转发"]
  end

  subgraph NAP["NAP"]
    ACCESS["应用和它的团队<br/>client id + secret，<br/>管理员共享的资源"]
    CONTENT["Prompt 和 Skill<br/>应用自己发布"]
    SPEC["App Spec<br/>每个 Agent → 一个模板"]
    USERS["用户<br/>由应用开通"]
    WS["Workspace<br/>每个用户每个 Agent 一个"]
  end

  DEPLOY -- "发布" --> CONTENT
  DEPLOY -- "apply" --> SPEC
  ACCESS -. "在这里解析引用" .-> SPEC
  CONTENT -. "按名字引用" .-> SPEC
  SPEC -- "创建和更新" --> WS
  BACKEND -- "登录时开通" --> USERS
  USERS -- "拥有" --> WS
  BACKEND -- "ensure agent、<br/>以用户身份对话" --> WS

  classDef app fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
  classDef access fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95
  classDef declared fill:#fef3c7,stroke:#f59e0b,color:#78350f
  classDef running fill:#dcfce7,stroke:#22c55e,color:#14532d
  class DEPLOY,BACKEND app
  class ACCESS access
  class CONTENT,SPEC declared
  class USERS,WS running
</pre>

蓝色是你的应用。NAP 这边，紫色管权限（应用是谁、能用什么），黄色是应用声明的内容，绿色是为它的用户跑起来的东西。

动手之前，先知道这几点：

- **用户是应用自己的。** 应用用自己的用户 id 开通用户。这些用户登录不了 NAP，只能通过你的应用用到自己的 Agent。
- **隔离由 NAP 保证。** 每个用户的 Workspace 只属于这个用户。不管应用怎么转发请求，一个用户的 Agent 都看不到另一个用户的文件和会话。
- **应用只凭自己的凭据办事。** 它不经手用户的密码；需要以某个用户身份操作时，用 client id 和 secret 换一个短期 token。

## 注册应用

由管理员在 **OAuth 应用**（`⌘K` → **OAuth 应用**）里注册。注册后会拿到 client id 和 secret（secret 只放在后端），同时会建一个**以应用命名的团队**，应用开通的每个用户都会加入这个团队。

spec 只能用共享给这个团队的东西。第一次 apply 之前，请管理员（注册应用的人就是这个团队的管理员）把下面这些共享给它：

- Agent 要用的**模型供应商**（**模型供应商** app）；
- 内置环境以外的**运行环境**（**运行环境** app）；
- 应用要用、但不是它自己发布的 **Skill** 或 **Prompt**（资源库）。

spec 不能给自己授权：应用的用户能用什么，由人在界面上决定。

## 写 spec

spec 放在应用的代码仓库里，和它要发布的 Prompt、Skill 放在一起：

```yaml
apiVersion: nap.app/v1

mcp_servers:
  app-api: { url: https://api.example.com/mcp, identify_caller: true }

agents:
  assistant:
    runtime:
      agent_type: claude-code
      max_concurrency: 4
      compute: { cpu_limit: "1", memory_limit: 2Gi }
    model: { provider: main-provider, name: large-model, small: small-model }
    prompt: assistant            # apply 时锁定到当前版本；也可以写 assistant@3
    skills: [report-writer]
    mcp: { app-api: {} }
    commands:
      summary: { content: "总结一下今天做了什么" }
    schedules:
      weekly-digest: { cron: "0 9 * * 1", timezone: UTC, prompt: "写本周周报" }
    calls: [researcher]
  researcher:
    runtime: { agent_type: codex }
    model: { provider: main-provider, name: large-model }

shared_folders:
  notes:                         # 两个 Workspace 里都在 /mnt/afs/notes
    owner: assistant
    members: { researcher: read_only }
```

| 字段 | 声明什么 |
|---|---|
| `agents.<name>.runtime` | Agent 内核、运行环境、计算资源、副本范围（`scaling`）、每个副本同时跑几轮对话（`max_concurrency`）、每轮最多调几次模型（`max_steps`） |
| `model` | 共享给应用的模型供应商（按名字）和要用的模型 |
| `prompt` | 按名字引用 Prompt。不写版本时，每次 apply 都锁定到当时的最新版本 |
| `skills` | 按名字引用 Skill |
| `mcp` | 这个 Agent 用 spec 里 `mcp_servers` 的哪几个 |
| `settings` | Agent 内核自己的设置，原样透传 |
| `commands`、`schedules` | 斜杠命令和定时任务。定时任务默认关闭，写 `enabled: true` 才开 |
| `calls` | 这个 Agent 会把活交给 spec 里的哪些 Agent，都在同一个用户名下 |
| `mcp_servers` | MCP 服务，所有 Agent 共用一份声明。`identify_caller: true` 表示这是应用自己跑的服务：Agent 调它时，平台会附上签名，说明是哪个用户、哪个 Workspace 在调 |
| `shared_folders` | 每个用户一份的共享文件夹，归这个用户的某个 Agent 所有，挂载到其他 Agent 里 |

这份文档有三条规矩：

- **不认识的字段直接拒绝。** 写错一个字母会马上报错，不会被悄悄忽略；以后的版本新增字段，也不会和你今天写的东西撞上。
- **内容只按名字引用。** spec 里写 `prompt: assistant`，不写 Prompt 正文。正文放在资源库里，有版本。
- **集合都按名字做 key。** Agent、MCP 服务、命令、定时任务、文件夹都是 map，改一项就是改一个 key。

## 每次部署都 apply

部署步骤先发布内容，再 apply spec。整个过程是幂等的：同样的 Prompt 正文、同样的 Skill 包重复发布，版本不变；spec 解析出来和当前生效的一样，什么都不会改。所以每次部署都跑一遍就行。

用 [server SDK](https://www.npmjs.com/package/@neutree-ai/server-sdk)：

```ts
import { AppClient } from '@neutree-ai/server-sdk'

const platform = new AppClient({ baseUrl, clientId, clientSecret })

await platform.publishPrompt('assistant', await readFile('nap/prompts/assistant.md', 'utf8'))
await platform.publishSkill('report-writer', await readFile('nap/skills/report-writer.tar.gz'))

const spec = await readFile('nap/spec.yaml', 'utf8')
const plan = await platform.applySpec(spec, { dryRun: true })
console.log(plan.plan, plan.shared_folders)
await platform.applySpec(spec)
```

也可以直接调 HTTP 接口，用 client id 和 secret 做 Basic 认证：

```bash
curl -u "$CLIENT_ID:$CLIENT_SECRET" -X PUT "$NAP_URL/apps/v1/spec?dry_run=true" \
  -H 'Content-Type: application/yaml' --data-binary @nap/spec.yaml
```

plan 里每个 Agent 会标成 `create`、`update`（附上改了哪些字段）、`delete` 或 `unchanged`，共享文件夹也一样。只要有一个引用解析不了，整次 apply 就失败，并列出所有问题。最常见的是"provider main-provider is not published by or shared with the application"：意思是要找管理员共享，不是要改 spec。

Skill 压缩包要可复现地打包（条目排好序、时间戳固定）。判断是不是新版本看的是包的字节，每次重新打包都带新时间戳的话，每次部署都会多出一个版本。

## 用户和他们的 Agent

用户每次登录，应用都用自己稳定的用户 id 开通一下：

```ts
await platform.upsertUser(user.id, { displayName: user.name, email: user.email })
```

用户第一次用到某个 Agent 时，应用请求它的 Workspace。这时才从 Agent 的模板创建，之后再请求就直接返回：

```ts
const { workspace_id } = await platform.ensureAgent(user.id, 'assistant')
const nap = platform.as(user.id)   // 以这个用户身份对话、读写文件、管理会话
```

每个 Workspace 都是一个在跑的容器，所以等用户真用到某个 Agent 时再请求，不要一上来就给所有用户全建好。

浏览器里的对话要经过你的后端：server SDK 的 session relay 以登录用户的身份转发 UI SDK 的请求，浏览器始终拿不到 token。应用自己跑的 MCP 服务上，用 SDK 的 `CallerVerifier` 校验调用方签名，就知道是哪个用户的 Agent 在调。

删用户时，先删它的 Agent Workspace，再删用户。

## 修改 spec

改 spec、部署、看 plan。apply 之后，受影响的 Workspace 会在**没有对话在跑的时候**跟上：空闲的马上更新，忙的在空下来后半分钟左右更新。换了 Agent 内核或计算资源会重启 Workspace；其他改动原地重新加载，文件和会话都在。

`GET /apps/v1/spec/status`（`platform.specStatus()`）按 Agent 显示有多少 Workspace 已经跟上、有多少卡住了。卡住的 Workspace 会在 `blocked` 里写明原因，通常是某个 Skill 或运行环境没共享给应用的团队，或者共享文件夹的几个 Workspace 不在同一个运行环境。把原因解决掉，它会自己跟上。

`GET /apps/v1/spec` 返回当前生效的 spec，每个 Prompt 都标着实际锁定的版本，可以当作所有用户正在跑什么的记录。

有几类改动的行为不一样：

- **Prompt** 只在 apply 时更新。想有意识地采用新版本，就写成 `assistant@3` 锁住。
- **Skill** 不锁版本。新发布的包就成了所有用到这个 Skill 的 Agent 加载的版本，不用 apply。发布 Skill 要当成一次部署来对待。
- **单副本还是弹性伸缩**在创建 Workspace 时就定了。改了只影响新建的 Workspace；副本范围本身可以随时改。

## 删除 Agent 或文件夹

spec 去掉一个 Agent、去掉一个共享文件夹，或者给文件夹换了 owner，都会被拒绝，除非带上 `prune` 再 apply。prune 会删掉去掉的 Agent 在所有用户名下的 Workspace，文件和会话一起删；共享文件夹则会收回每个用户的那一份，内容一起删。prune 之前先看 dry run 的 plan，也不要把 `prune` 放进自动部署里。

## spec 暂时还不支持的

每个用户在每个 Agent 下只有一个 Workspace。spec 暂时还不能声明记忆库、每个用户的凭证和插件，Skill 也还不能锁版本。spec 不收不认识的字段，所以今天不会误写这些字段；以后加上它们，也不会改变你现在写的 spec 的含义。
