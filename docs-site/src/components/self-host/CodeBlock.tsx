import { useEffect, useState } from 'preact/hooks'

interface Props {
  /** Raw code. May span multiple lines; rendered and copied verbatim. */
  children: string
  /** Shiki language id. bash / yaml / dotenv / json / typescript, etc. */
  lang?: string
}

// Cache the shiki highlighter globally to avoid reloading languages/themes.
let highlighterPromise: Promise<typeof import('shiki')> | null = null
const loadShiki = () => {
  if (!highlighterPromise) highlighterPromise = import('shiki')
  return highlighterPromise
}

export default function CodeBlock({ children, lang = 'bash' }: Props) {
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
        aria-label="Copy code"
        onClick={copy}
      >
        {copied ? 'Copied' : 'Copy'}
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
