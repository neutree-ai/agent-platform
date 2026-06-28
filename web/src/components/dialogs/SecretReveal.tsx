import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SecretRevealProps {
  /** The plaintext secret, shown once. */
  value: string
  /** Optional warning copy; defaults to the generic "save it now" message. */
  warning?: string
}

/**
 * Reveal-once secret block: a warning banner plus a monospace value with a
 * copy-to-clipboard button. The secret is never re-fetchable, so the caller
 * shows this exactly once right after creation.
 */
export function SecretReveal({ value, warning }: SecretRevealProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
        <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span>{warning ?? t('components.secretReveal.saveNow')}</span>
      </div>
      <div className="relative">
        <pre className="overflow-x-auto rounded-md border border-foreground/[0.08] bg-foreground/[0.04] p-3 pr-12 font-mono text-xs">
          {value}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={t('components.secretReveal.copy')}
          title={t('components.secretReveal.copy')}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground"
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
