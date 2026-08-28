import { setInlineHelpBrand } from '@/docs/inline-help/_load'
import { api } from '@/lib/api/client'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react'

const DEFAULT_BRAND_SHORT_NAME = 'NAP'
const DEFAULT_BRAND_FULL_NAME = 'Neutree Agent Platform'

interface BrandContextType {
  shortName: string
  fullName: string
  logoUrl: string | null
  /** Re-fetches from /api/branding — call after saving Admin > Branding so the
   *  new name/logo show up immediately instead of needing a hard refresh. */
  refresh: () => Promise<void>
}

const noopRefresh = async () => {}

const BrandContext = createContext<BrandContextType>({
  shortName: DEFAULT_BRAND_SHORT_NAME,
  fullName: DEFAULT_BRAND_FULL_NAME,
  logoUrl: null,
  refresh: noopRefresh,
})

function buildLogoUrl(hasCustomLogo: boolean, logoVersion: string | null): string | null {
  return hasCustomLogo && logoVersion ? `/api/branding/logo?v=${logoVersion}` : null
}

// Admin-configured product name/logo (see Admin > Branding), served from a
// public endpoint since the login page renders before any auth token exists.
// Falls back to the built-in defaults until the fetch resolves (or forever,
// on failure) — same fetch-with-default-fallback shape as the WeCom-enabled
// check on LoginPage.
export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Omit<BrandContextType, 'refresh'>>({
    shortName: DEFAULT_BRAND_SHORT_NAME,
    fullName: DEFAULT_BRAND_FULL_NAME,
    logoUrl: null,
  })

  const refresh = useCallback(async () => {
    try {
      const res = await api.getBranding()
      setInlineHelpBrand(res.shortName)
      setBrand({
        shortName: res.shortName,
        fullName: res.fullName,
        logoUrl: buildLogoUrl(res.hasCustomLogo, res.logoVersion),
      })
    } catch {
      /* keep whatever's currently set */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    document.title = `${brand.shortName} — ${brand.fullName}`
  }, [brand.shortName, brand.fullName])

  return <BrandContext.Provider value={{ ...brand, refresh }}>{children}</BrandContext.Provider>
}

export function useBrand(): BrandContextType {
  return useContext(BrandContext)
}
