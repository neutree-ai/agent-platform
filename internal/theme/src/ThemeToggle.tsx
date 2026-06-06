import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type Theme } from './ThemeProvider'

const OPTIONS: ReadonlyArray<{ value: Theme; icon: typeof Sun; label: string; title: string }> = [
  { value: 'light', icon: Sun, label: 'Light', title: 'Light theme' },
  { value: 'dark', icon: Moon, label: 'Dark', title: 'Dark theme' },
  { value: 'system', icon: Monitor, label: 'System', title: 'Follow system' },
]

export function ThemeToggle({ compact = false }: { compact?: boolean } = {}) {
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-0.5"
    >
      {OPTIONS.map(({ value, icon: Icon, label, title }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={title}
            onClick={() => setTheme(value)}
            className={[
              'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" />
            {!compact && <span>{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
