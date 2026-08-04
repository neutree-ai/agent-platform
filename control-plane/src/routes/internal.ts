import { Hono } from 'hono'

const internal = new Hono()

// Health check
internal.get('/health', (c) => c.json({ status: 'ok' }))

export default internal
