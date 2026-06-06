标签用于对 workspace 进行分组和快速筛选。

## 使用方式

1. **创建标签** — 在此页面点击 New Tag，设定名称和颜色
2. **打标签** — 在 Dashboard 的 workspace 菜单（三点按钮）中勾选标签
3. **按标签筛选** — 侧边栏顶部的标签按钮可快速过滤 workspace 列表

## 设计建议

- 按**用途**分类：`production`、`staging`、`experiment`
- 按**团队**分类：`frontend`、`backend`、`data`
- 按**状态**分类：`active`、`archived`、`review`

颜色可用于直观区分不同类别。

## 注意事项

- 删除标签会自动从所有 workspace 上移除
- 标签筛选为 OR 逻辑 — 选中多个标签时，匹配任一即显示
