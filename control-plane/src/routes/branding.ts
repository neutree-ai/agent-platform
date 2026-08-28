import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { getSettings } from '../services/db/system-settings'

const DEFAULT_SHORT_NAME = 'NAP'
const DEFAULT_FULL_NAME = 'Neutree Agent Platform'

const branding = new Hono<AppEnv>()

// Content hash of the logo, not a timestamp — changes exactly when the logo
// itself changes (not on unrelated field edits), and needs no schema change.
// The frontend appends it as a `?v=` query param on the logo URL so an
// admin's own upload shows up immediately instead of needing a hard refresh
// (the browser otherwise happily reuses whatever it last fetched from the
// same URL, `Cache-Control: no-cache` notwithstanding).
function logoVersion(data: string): string {
  return createHash('sha1').update(data).digest('hex').slice(0, 8)
}

// Public — no auth. The login page renders before any auth token exists, so
// the product name/logo need a read path that doesn't require one. Logo
// bytes are NOT included in this payload (see GET /logo below) so this stays
// small regardless of how big the configured logo is.
branding.get('/', async (c) => {
  const settings = await getSettings()
  const hasCustomLogo = !!(settings.branding_logo_data && settings.branding_logo_mime)
  return c.json({
    shortName: settings.branding_short_name || DEFAULT_SHORT_NAME,
    fullName: settings.branding_full_name || DEFAULT_FULL_NAME,
    hasCustomLogo,
    logoVersion: hasCustomLogo ? logoVersion(settings.branding_logo_data as string) : null,
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
