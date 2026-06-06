## Skills

Skills 是可复用的工具包，启用后 agent 可以在 session 中调用。

Skill 以文件形式挂载到容器中，agent 启动时自动加载。每个 skill 包含 `SKILL.md` 描述文件和工具脚本。

启用后对该 workspace 下所有新 session 生效。Skills 在 Library 中统一管理，支持上传压缩包或从 Git 仓库导入。
