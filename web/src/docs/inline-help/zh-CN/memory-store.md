记忆库（memory store）以 path 为 key 存放 markdown 文件，给 agent 当跨会话的长期记忆用。

## 使用模型

- **记忆库**是 **user 级别**的资源，不绑定 workspace。一个用户可以有多个记忆库。
- 工作空间通过**挂载**的方式接入记忆库（一个 ws 最多挂 8 个）。
- 挂载后，agent 可以在容器内通过文件系统直接读写库里的记忆，每次写入都会在历史记录里留痕。

## Slug

记忆库的 `slug` 在你账号下唯一，是稳定标识符。挂到工作空间后，文件挂载点的目录名就用这个 slug。

> 推荐用短小、语义化的 slug：`personal`、`work-context`、`project-acme`。

## Path 约定

记忆里的 path 是你自己定的，建议按内容类型组织：

- `/user/profile.md` — 关于你
- `/feedback/<topic>.md` — 你的偏好和纠错
- `/project/<slug>.md` — 当前项目的上下文
- `/reference/<system>.md` — 外部系统的指针（Linear、Slack 频道等）

## 默认库

每个用户至多一个**默认记忆库**。后续会用于「新建工作空间时自动挂载」的 onboarding 流程（暂未实装）。
