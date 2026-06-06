Service Token 用于外部系统通过 API 访问平台，无需用户登录。

## 典型用途

- 外部服务通过 REST API 管理 workspace
- 自动化脚本批量操作

## 使用方式

在 HTTP 请求中通过 `Authorization` header 传递：

```
Authorization: Bearer <token>
```

## 注意事项

- Token 创建后**仅显示一次**，请立即保存
- 每个 token 有独立的 name，便于识别和管理
- 删除 token 后，使用该 token 的所有请求将立即失效
