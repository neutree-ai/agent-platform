import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { getSettings } from '../services/db/system-settings'

const DEFAULT_SHORT_NAME = 'NAP'
const DEFAULT_FULL_NAME = 'Neutree Agent Platform'

const branding = new Hono<AppEnv>()

// Public — no auth. The login page renders before any auth token exists, so
// the product name/logo need a read path that doesn't require one. Logo
// bytes are NOT included in this payload (see GET /logo below) so this stays
// small regardless of how big the configured logo is.
branding.get('/', async (c) => {
  const settings = await getSettings()
  return c.json({
    shortName: settings.branding_short_name || DEFAULT_SHORT_NAME,
    fullName: settings.branding_full_name || DEFAULT_FULL_NAME,
    hasCustomLogo: !!(settings.branding_logo_data && settings.branding_logo_mime),
  })
})

branding.get('/logo', async (c) => {
  const settings = await getSettings()
  if (!settings.branding_logo_data || !settings.branding_logo_mime) {
    return c.notFound()
  }
  c.header('Cache-Control', 'no-cache')
  return c.body(Buffer.from(settings.branding_logo_data, 'base64'), 200, {
    'Content-Type': settings.branding_logo_mime,
  })
})

export default branding
