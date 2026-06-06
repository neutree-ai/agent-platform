Service tokens let external systems call the platform's API without a
user login. Use them anywhere an automated client needs to act on your
behalf.

## Typical uses

- External services managing workspaces via REST API
- Automation scripts performing batch operations

## How to use

Pass the token in the HTTP `Authorization` header:

```
Authorization: Bearer <token>
```

## Notes

- The raw token is **shown only once at creation** — copy it immediately
  and store it somewhere safe (a secret manager, your CI's secret store).
- Give each token a distinct name so you can recognize and revoke it later.
- Revoking a token invalidates every request that uses it, with no
  grace period.
