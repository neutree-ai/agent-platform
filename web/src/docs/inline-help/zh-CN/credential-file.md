以文件的方式注入凭据。Session 启动时，平台会将 **Value** 写入指定的 **File path**，并设置对应的 **File mode**（权限）。

## 典型用法

- 证书文件（`.pem`, `.crt`）
- 配置文件（`~/.gitconfig`）
- 服务账号 JSON（`credentials.json`）

## 字段说明

- **File path** — 容器内的目标路径，支持 `~` 展开为用户主目录
- **File mode** — Unix 文件权限：
  - `0600` Private — 仅所有者可读写（推荐用于密钥）
  - `0400` Read-only — 仅所有者只读
  - `0644` Shared — 所有人可读
  - `0755` Executable — 所有人可读可执行（脚本）

## 注意事项

- 路径中的目录会自动创建
- 文件末尾会自动补换行符
- 同名 credential 会覆盖已有值
