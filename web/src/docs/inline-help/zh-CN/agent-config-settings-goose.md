## Agent Settings

传递给 Goose 运行时的配置参数，YAML 格式，合并到 `~/.config/goose/config.yaml`。

```yaml
GOOSE_AUTO_COMPACT_THRESHOLD: 0.6
```

- **GOOSE_AUTO_COMPACT_THRESHOLD** — 上下文自动压缩阈值（0–1，默认 `0.8`，`0` 表示禁用）

**平台托管字段**

`GOOSE_MODEL`、`GOOSE_MODE`、`extensions` 由平台管理，此处的同名顶层配置会被忽略。

参考 [Goose 配置文档](https://goose-docs.ai/docs/guides/config-files/) 了解可用配置项。
