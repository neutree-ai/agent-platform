import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { deleteCookie } from 'hono/cookie'
import { COOKIE_NAME, oauth } from '../lib/session'
import { ErrorSchema, LogoutResponseSchema, UserMeSchema } from '../schemas'

const auth = new OpenAPIHono()

// /login + /callback come from the shared OAuth client. They're plain
// redirect handlers so we mount them outside the OpenAPI spec.
auth.route('/', oauth.redirectRoutes)

auth.openapi(
  createRoute({
    method: 'get',
    path: '/me',
    tags: ['auth'],
    security: [{ bearerAuth: [] }],
    summary: 'Return the authenticated user',
    responses: {
      200: {
        description: 'Authenticated user',
        content: { 'application/json': { schema: UserMeSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  (c) => {
    const user = c.get('user' as never) as
      | { sub: string; username: string; name: string }
      | undefined
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    return c.json({ id: user.sub, username: user.username, name: user.name }, 200)
  },
)

auth.openapi(
  createRoute({
    method: 'post',
    path: '/logout',
    tags: ['auth'],
    summary: 'Clear the session cookie',
    responses: {
      200: {
        description: 'Logged out',
        content: { 'application/json': { schema: LogoutResponseSchema } },
      },
    },
  }),
  (c) => {
    deleteCookie(c, COOKIE_NAME, { path: '/' })
    return c.json({ success: true as const }, 200)
  },
)

export default auth
