import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  WALLPAPERS,
  type Wallpaper,
  useWallpaper,
  wallpaperSwatchClassName,
} from '@/hooks/useWallpaper'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

function wallpaperLabel(t: TFunction, w: Wallpaper): string {
  switch (w) {
    case 'aurora':
      return t('components.preferences.wallpaper.options.aurora')
    case 'minimal':
      return t('components.preferences.wallpaper.options.minimal')
    case 'cool':
      return t('components.preferences.wallpaper.options.cool')
    case 'warm':
      return t('components.preferences.wallpaper.options.warm')
  }
}

/**
 * 4 crystal-ball previews for the desktop wallpaper preset. Each ball
 * embeds the actual `desktop-wallpaper--<name>` background, so the preview
 * is the wallpaper — no separate thumbnails to keep in sync. Sphere depth
 * comes from inset specular highlight + outer drop shadow.
 *
 * Layout matches sibling rows in the appearance section: label on the
 * left, controls right-aligned. Active preset name appears as a small
 * caption below the balls so the picker is self-explanatory without
 * relying on hover tooltips.
 */
export function WallpaperPicker() {
  const { t } = useTranslation()
  const { wallpaper, setWallpaper } = useWallpaper()

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-foreground">{t('components.preferences.wallpaper.label')}</span>
      <div className="flex items-center gap-3">
        <span className="text-tiny text-muted-foreground">{wallpaperLabel(t, wallpaper)}</span>
        <div className="flex items-center gap-3">
          {WALLPAPERS.map((w) => {
            const selected = wallpaper === w
            return (
              <Tooltip key={w}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={wallpaperLabel(t, w)}
                    aria-pressed={selected}
                    onClick={() => setWallpaper(w)}
                    className={`relative h-7 w-7 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      selected ? 'ring-2 ring-primary' : ''
                    }`}
                  >
                    <span
                      className={`${wallpaperSwatchClassName(w)} block h-full w-full rounded-full`}
                    />
                    {/* Sphere depth — top-left specular + bottom shading + edge ring. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-full"
                      style={{
                        boxShadow:
                          'inset 0 3px 6px -2px oklch(1 0 0 / 0.55), inset 0 -3px 5px -3px oklch(0 0 0 / 0.25), 0 2px 5px -1px oklch(0 0 0 / 0.18), 0 0 0 1px oklch(var(--border) / 0.4)',
                      }}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{wallpaperLabel(t, w)}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </div>
  )
}
