## Agent Settings

Configuration passed to the Goose runtime, in YAML, merged into `~/.config/goose/config.yaml`.

```yaml
GOOSE_AUTO_COMPACT_THRESHOLD: 0.6
```

- **GOOSE_AUTO_COMPACT_THRESHOLD** — auto-compaction threshold for the context window (0–1, default `0.8`; `0` disables)

**Platform-managed keys**

`GOOSE_MODEL`, `GOOSE_MODE` and `extensions` are managed by the platform; same-name top-level keys here are ignored.

See the [Goose configuration docs](https://goose-docs.ai/docs/guides/config-files/) for available options.
