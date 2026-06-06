从 Git 仓库导入 skill。平台会自动克隆仓库并提取 skill 内容。

## URL 格式

- `https://github.com/owner/repo` — 导入整个仓库
- `owner/repo` — GitHub 简写
- `https://github.com/owner/repo/tree/branch/subpath` — 导入指定分支的子目录
- 支持 GitHub、GitLab 和自托管 Git 服务

## Access Token

私有仓库需要提供访问令牌：

- **None** — 公开仓库无需 token
- **Credential** — 从已配置的 Credential 中选择（仅列出 env 类型）
- **Manual** — 直接输入 token

## 自动检测

- **Name** 和 **Description** 会从 `SKILL.md` frontmatter 自动提取，也可手动覆盖
- 如果仓库中没有 `SKILL.md`，则使用仓库名作为 skill 名称
