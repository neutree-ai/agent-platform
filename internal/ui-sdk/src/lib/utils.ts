import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Register our custom font-size keys (tailwind.config.js) so twMerge treats
// text-{micro,mini,tiny} as font-size — otherwise it falls back to "unknown
// text-*" and dedupes them against color utilities like text-muted-foreground.
const twMergeCustom = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'mini', 'tiny'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMergeCustom(clsx(inputs))
}

/** Copy text to clipboard with fallback for non-secure contexts (HTTP). */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}
