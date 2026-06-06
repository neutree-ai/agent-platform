以环境变量的方式注入凭据。Session 启动时，平台会将 **Name** 作为变量名、**Value** 作为变量值写入容器环境。

## 典型用法

- `GITHUB_TOKEN` — Git 私有仓库克隆、GitHub API 调用
- `NPM_TOKEN` — 私有 npm registry 认证
- `DATABASE_URL` — 数据库连接串

## 注意事项

- Name 建议使用大写 + 下划线命名（`MY_SECRET`）
- 同名 credential 会覆盖已有值
- Value 在存储和传输过程中加密，不会明文出现在日志中
