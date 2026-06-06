Route external HTTP requests to a specified Workspace for execution.

## Field descriptions

- **Connector** — Select a created Webhook Connector
- **Endpoint Path** — Listening path, such as `/invoices`; combined with the Connector to form the full webhook URL
- **Workspace** — Which Workspace executes the task after the request is triggered
- **Secret** (optional) — Used to verify request validity, configured per Route and not at the Connector layer

## Secret verification

Secret is configured independently for each Route and supports two modes:

- **Plain** — The external system sends the secret string directly in the request header, and NAP allows the request if the values are equal. Suitable for internal networks or simple scenarios. The default header is `X-Webhook-Secret` and can be customized.
- **HMAC-SHA256** — The external system computes an HMAC-SHA256 over the request body with the secret, and puts the result in the request header as `sha256=<hex>`. Compatible with the GitHub signature format. The default header is `X-Hub-Signature-256` and can be customized.

Leaving it empty means no verification; any request is allowed through (recommended only for internal-network debugging). Click "Generate" to quickly generate a random secret. After the Route is created, you can click the secret pill on the Route card to view and copy the stored value.

## Prompt template

Define how to convert an HTTP request into an agent prompt. Available variables:

| Variable | Description |
|------|------|
| `{body}` | Full request body |
| `{body.field}` | Nested field in the request body |
| `{query.key}` | URL query parameter |
| `{headers.name}` | Request header |
| `{method}` | HTTP method |
| `{path}` | Request path |

If left empty, the original request body is used directly. You can also select from the Prompt library.

## Filters

Filter rules decide which requests trigger tasks. All rules must be satisfied at the same time (AND logic).

| Operator | Description |
|--------|------|
| `=` | Exact match |
| `≠` | Not equal |
| `in` | Value is in the list (comma-separated) |
| `exists` | Whether the field exists |

If no filter is configured, all requests trigger.
