Sandbox 是隔离的容器环境，用于运行代码、执行命令和文件操作。

## 镜像

任意 Docker 镜像地址。推荐使用 bookworm 镜像（预装 git/curl/ps 等工具）：
- `node:22-bookworm` — Node.js 环境（已预热，秒级启动）
- `python:3.12-bookworm` — Python 环境（已预热，秒级启动）
- 其他镜像也可使用，首次启动需拉取

## 资源配置

- **CPU**：Kubernetes CPU 单位 — `500m` = 0.5 核，`1` = 1 核
- **Memory**：`256Mi`、`512Mi`、`1Gi` 等

## 超时时间

沙箱存活时长，到期自动销毁。支持以下格式：
- `30s` — 30 秒
- `10m` — 10 分钟
- `1h` — 1 小时（默认）
- `1d` — 1 天
- 纯数字按秒计算

## 使用方式

沙箱可以由 agent 通过 MCP tool 自动创建和管理，也可以在此手动创建。Agent 可用的 tool 包括：
- `create_sandbox` — 创建沙箱
- `sandbox_run_command` — 执行命令
- `sandbox_read_file` / `sandbox_write_files` — 文件读写
- `kill_sandbox` — 销毁沙箱
