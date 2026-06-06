OAuth 应用接入用于让第三方服务通过 OAuth 2.0 授权码流程，让用户登录
NAP 并以用户身份调用平台 API。

## 关键字段

- **Client ID** — 公开标识，第三方应用在 authorize URL 中携带
- **Client Secret** — 保密凭据，第三方应用用它换取 token；仅在创建
  和轮换时显示一次
- **Redirect URIs** — 允许平台在授权完成后跳回的回调地址；必须与
  authorize 请求中的 URI **完全一致**

## 创建流程

1. 在这里登记应用：名称、Redirect URIs、可选的主页 URL（会显示在授权
   同意页）
2. 立即复制 Client ID 和 Client Secret —— Secret 关闭后不再显示
3. 在第三方应用里配置上述凭据，把它的 OAuth 客户端指向本平台

## 轮换密钥

轮换会签发新的 Secret 并使旧 Secret 立即失效。已经发出去的 refresh
token 仍然有效；仅依赖 Secret 的认证流程（token exchange、client
credential 流）会受影响。
