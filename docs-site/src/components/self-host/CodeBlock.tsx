import { useEffect, useState } from 'preact/hooks'

interface Props {
  /** Raw code. May span multiple lines; rendered and copied verbatim. */
  children: string
  /** Shiki language id. bash / yaml / dotenv / json / typescript, etc. */
  lang?: string
  /** UI locale for display strings (button + aria-label). */
  locale?: string
}

const STR = {
  en: {
    copyAria: 'Copy code',
    copy: 'Copy',
    copied: 'Copied',
  },
  'zh-CN': {
    copyAria: '复制代码',
    copy: '复制',
    copied: '已复制',
  },
} as const

// Cache the shiki highlighter globally to avoid reloading languages/themes.
let highlighterPromise: Promise<typeof import('shiki')> | null = null
const loadShiki = () => {
  if (!highlighterPromise) highlighterPromise = import('shiki')
  return highlighterPromise
}

export default function CodeBlock({
  children,
  lang = 'bash',
  locale = 'en',
}: Props) {
  const t = STR[locale as keyof typeof STR] ?? STR.en
  const [copied, setCopied] = useState(false)
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { codeToHtml } = await loadShiki()
        const out = await codeToHtml(children, {
          lang,
          themes: { light: 'github-light', dark: 'github-dark' },
          // No inline color; expose --shiki-light / --shiki-dark CSS variables
          // instead, switched by [data-theme] in self-host-shell.css.
          defaultColor: false,
        })
        if (!cancelled) setHtml(out)
      } catch {
        // Fall back to plain text if shiki fails to load; don't block rendering.
        if (!cancelled) setHtml(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [children, lang])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Silently fail if the clipboard is disabled or permission is denied.
    }
  }

  return (
    <div class="sh-codeblock">
      <button
        type="button"
        class="sh-codeblock-copy"
        aria-label={t.copyAria}
        onClick={copy}
      >
        {copied ? t.copied : t.copy}
      </button>
      {html ? (
        // shiki output: the outer <pre class="shiki ..."> carries token colors inline
        <div
          class="sh-codeblock-shiki"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre class="sh-codeblock-plain">
          <code>{children}</code>
        </pre>
      )}
    </div>
  )
}
