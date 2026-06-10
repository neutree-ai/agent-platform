# Authentication

All requests must include a **NAP Service Token** via the `Authorization` header:

```
Authorization: Bearer <token>
```

## Obtain a Service Token

1. Sign in to the NAP Web UI and go to **Integration → Tokens** (route `/integration/tokens`)
2. Click **Create Service Token**, enter a Name, and confirm
3. Copy the token from the dialog (**shown only once**)
