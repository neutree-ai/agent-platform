# @neutree-ai/sandbox

TypeScript/JavaScript SDK for NAP Sandbox — create and manage isolated container environments for AI agents, code execution, and development.

## Install

```bash
npm install @neutree-ai/sandbox
```

## Quick Start

```typescript
import { SandboxClient } from '@neutree-ai/sandbox'

const client = new SandboxClient({
  baseUrl: 'https://sandbox.example.com', // your sandbox service URL
  token: 'tos_...',                        // NAP Service Token
})

// Create a sandbox
const sbx = await client.create({
  image: 'node:22-bookworm',
  resource: { cpu: '1', memory: '1Gi' },
  timeoutSeconds: 21600, // 6h
})

// Run commands
const result = await client.exec(sbx.id, 'echo "Hello from sandbox"')
console.log(result.stdout)

// Read and write files
await client.writeFiles(sbx.id, [
  { path: '/workspace/index.js', content: 'console.log("hi")' },
])
const content = await client.readFile(sbx.id, '/workspace/index.js')

// Get preview URL (for dev servers)
const previewUrl = client.getPreviewUrl(sbx.id, 3000)
// → https://{id}-3000.<your-sandbox-host>/

// Clean up
await client.delete(sbx.id)
```

## API

### `new SandboxClient(options)`

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | Sandbox service base URL. Required. |
| `token` | `string` | NAP Service Token. Required. |

### Methods

| Method | Description |
|--------|-------------|
| `create(opts)` | Create a sandbox |
| `list(filter?)` | List sandboxes |
| `get(id)` | Get sandbox info |
| `delete(id)` | Delete a sandbox |
| `renew(id, timeoutSeconds)` | Extend sandbox expiration |
| `exec(id, command, opts?)` | Execute a command |
| `readFile(id, path)` | Read a file |
| `writeFiles(id, files)` | Write files |
| `getEndpointUrl(id, port)` | Get internal endpoint URL |
| `getPreviewUrl(id, port)` | Get public preview URL |

## Preview URLs

After starting a dev server inside a sandbox, use `getPreviewUrl()` to get a publicly accessible URL. The shape mirrors `baseUrl` with the sandbox ID and port as a subdomain:

```
https://{sandboxId}-{port}.<sandbox-host>/
```

Preview URLs are public — the sandbox ID (UUID) serves as the access token.

## License

MIT
