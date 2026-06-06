将外部 HTTP 请求路由到指定 Workspace 执行。

## 字段说明

- **Connector** — 选择已创建的 Webhook connector
- **Endpoint Path** — 监听路径（如 `/invoices`），与 connector 组合成完整 webhook URL
- **Workspace** — 请求触发后在哪个 workspace 执行任务
- **Secret**（可选） — 用于校验请求合法性，按 route 配置，不在 connector 层

## Secret 校验

Secret 是每个 route 独立配置的，支持两种模式：

- **明文（Plain）** — 外部系统在请求头中直接带上 secret 字符串，NAP 比对相等即放行。适用于内网或简单场景。默认 header 为 `X-Webhook-Secret`，可自定义。
- **HMAC-SHA256** — 外部系统用 secret 对 request body 做 HMAC-SHA256，结果以 `sha256=<hex>` 形式放在请求头中。兼容 GitHub 签名格式，默认 header 为 `X-Hub-Signature-256`，可自定义。

留空表示不校验，任何请求都会被放行（仅建议在内网调试时使用）。点击「生成」可快速生成一个随机 secret。Route 创建后，可在 route 卡片上点击 secret pill 查看并复制已存的值。

## Prompt 模板

定义如何将 HTTP 请求转为 agent prompt。可用变量：

| 变量 | 说明 |
|------|------|
| `{body}` | 完整请求体 |
| `{body.field}` | 请求体中的嵌套字段 |
| `{query.key}` | URL query 参数 |
| `{headers.name}` | 请求头 |
| `{method}` | HTTP 方法 |
| `{path}` | 请求路径 |

留空则直接使用原始请求体。也可以从 Prompt 库中选择。

## Filters

过滤规则决定哪些请求会触发任务。所有规则必须同时满足（AND 逻辑）。

| 操作符 | 说明 |
|--------|------|
| `=` | 精确匹配 |
| `≠` | 不等于 |
| `in` | 值在列表中（逗号分隔） |
| `exists` | 字段是否存在 |

不配置 filter 则所有请求都会触发。
