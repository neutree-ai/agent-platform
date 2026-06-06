import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { ApiUserProfileSchema, UserProfilePayloadSchema } from '../../../../internal/types/api'
import type { AppEnv } from '../../lib/types'
import { getUserProfile, patchUserProfile } from '../../services/db/user-profile'

const profile = new OpenAPIHono<AppEnv>()

const getProfileRoute = createRoute({
  method: 'get',
  path: '/profile',
  tags: ['me'],
  summary: 'Get current user UI profile (client-managed jsonb)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Profile payload',
      content: { 'application/json': { schema: ApiUserProfileSchema } },
    },
  },
})

profile.openapi(getProfileRoute, async (c) => {
  const user = c.get('user')
  const payload = await getUserProfile(user.sub)
  return c.json({ payload }, 200)
})

const patchProfileRoute = createRoute({
  method: 'patch',
  path: '/profile',
  tags: ['me'],
  summary: 'Shallow-merge a partial payload into the current user UI profile',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: UserProfilePayloadSchema } } },
  },
  responses: {
    200: {
      description: 'Merged profile payload',
      content: { 'application/json': { schema: ApiUserProfileSchema } },
    },
  },
})

profile.openapi(patchProfileRoute, async (c) => {
  const user = c.get('user')
  const patch = c.req.valid('json')
  const payload = await patchUserProfile(user.sub, patch)
  return c.json({ payload }, 200)
})

export default profile
