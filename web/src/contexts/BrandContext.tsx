import { setInlineHelpBrand } from '@/docs/inline-help/_load'
import { api } from '@/lib/api/client'
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react'

const DEFAULT_BRAND_SHORT_NAME = 'NAP'
const DEFAULT_BRAND_FULL_NAME = 'Neutree Agent Platform'

interface BrandContextType {
  shortName: string
  fullName: string
  logoUrl: string | null
}

const BrandContext = createContext<BrandContextType>({
  shortName: DEFAULT_BRAND_SHORT_NAME,
  fullName: DEFAULT_BRAND_FULL_NAME,
  logoUrl: null,
})

// Admin-configured product name/logo (see Admin > Branding), served from a
// public endpoint since the login page renders before any auth token exists.
// Falls back to the built-in defaults until the fetch resolves (or forever,
// on failure) — same fetch-with-default-fallback shape as the WeCom-enabled
// check on LoginPage.
export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<BrandContextType>({
    shortName: DEFAULT_BRAND_SHORT_NAME,
    fullName: DEFAULT_BRAND_FULL_NAME,
    logoUrl: null,
  })

  useEffect(() => {
    api
      .getBranding()
      .then((res) => {
        setInlineHelpBrand(res.shortName)
        setBrand({
          shortName: res.shortName,
          fullName: res.fullName,
          logoUrl: res.hasCustomLogo ? '/api/branding/logo' : null,
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    document.title = `${brand.shortName} — ${brand.fullName}`
  }, [brand.shortName, brand.fullName])

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}

export function useBrand(): BrandContextType {
  return useContext(BrandContext)
}
