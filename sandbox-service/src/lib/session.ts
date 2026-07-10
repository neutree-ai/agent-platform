// Imported via relative path so esbuild bundles the .ts source inline.
// `@neutree-ai/oauth-client`'s package.json `exports` points at `./src/index.ts`, which
// node can't load directly at runtime.
import { createOAuthClient } from '../../../internal/oauth-client/src/index'

export const oauth = createOAuthClient({
  clientId: process.env.OAUTH_CLIENT_ID || 'sandbox-service',
  serviceUrl: process.env.SANDBOX_SERVICE_URL || 'http://localhost:3006',
  napUrl: process.env.NAP_OAUTH_URL || process.env.NAP_URL,
  cookieName: 'sandbox_token',
  jwtSecret: process.env.JWT_SECRET || 'sandbox-jwt-secret-change-me',
})

export const verifySessionToken = oauth.verifySessionToken
export const COOKIE_NAME = oauth.config.cookieName
