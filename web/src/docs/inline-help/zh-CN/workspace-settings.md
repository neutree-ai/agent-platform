Workspace 的基本信息和元数据配置。

## Name

Workspace 的显示名称，用于在侧边栏和其他界面中识别。

## Slug

Slug 是 workspace 的唯一标识符，其他 agent 可以通过 `@slug` 语法调用此 workspace。

- 只允许小写字母、数字和连字符
- 留空则不可被其他 agent 调用

## Visibility

控制 workspace 的可见性和可调用范围：

- **Private** — 仅自己可见，不可被调用
- **User** — 自己的其他 agent 可通过 `@slug` 调用
- **Public** — 所有 agent 均可调用

## Tags

标签用于对 workspace 进行分组和快速筛选。点击标签切换选中状态，修改即时生效。

- 在侧边栏可按标签过滤 workspace 列表
- 标签筛选为 OR 逻辑 — 选中多个时匹配任一即显示
- 标签可在 Settings 页面的 Tags 区域管理
