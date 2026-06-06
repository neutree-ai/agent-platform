import { Logo } from '@/components/Logo'
import { PreferencesDialog } from '@/components/PreferencesDialog'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Scope } from './Desktop'
import { WsSwitcher } from './WsSwitcher'

interface MenubarProps {
  scope: Scope
  workspaceId?: string
  onOpenCommandPalette: () => void
}

export function Menubar({ scope, workspaceId, onOpenCommandPalette }: MenubarProps) {
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center justify-between px-3 text-sm',
        'border-b border-foreground/[0.08]',
        'bg-background/30 backdrop-blur-2xl backdrop-saturate-150',
      )}
    >
      <div className="flex items-center gap-2">
        <Link
          to="/"
          aria-label="NAP"
          className="flex items-center text-foreground transition-opacity hover:opacity-80"
        >
          <Logo className="h-4 w-auto" />
        </Link>
        <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-foreground/[0.14]" />
        <WsSwitcher workspaceId={scope === 'ws' ? workspaceId : undefined} />
      </div>
      <div className="flex items-center gap-1">
        <CommandPaletteButton onOpen={onOpenCommandPalette} />
        <UserButton />
      </div>
    </header>
  )
}

function CommandPaletteButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex min-w-[14rem] items-center gap-2 rounded-full',
        'border border-foreground/[0.08] bg-foreground/[0.02] py-1 pl-2.5 pr-1.5',
        'text-muted-foreground/80 transition-colors',
        'hover:border-foreground/[0.16] hover:bg-foreground/[0.05] hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
      )}
    >
      <Search className="h-3.5 w-3.5 text-muted-foreground/70 transition-colors group-hover:text-foreground" />
      <span className="flex-1 text-left text-sm">
        {t('components.shell.menubar.commandPaletteHint')}
      </span>
      <kbd
        className={cn(
          'rounded border border-foreground/[0.10] bg-foreground/[0.05]',
          'px-1 text-mini font-medium tracking-wider text-muted-foreground',
        )}
      >
        ⌘K
      </kbd>
    </button>
  )
}

function UserButton() {
  const { user } = useAuth()
  const [prefsOpen, setPrefsOpen] = useState(false)

  if (!user) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setPrefsOpen(true)}
        className={cn(
          'flex items-center gap-2 rounded-full px-1.5 py-1',
          'text-muted-foreground/90 transition-colors',
          'hover:bg-foreground/[0.06] hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
            'bg-foreground/[0.10] text-mini font-medium uppercase text-foreground',
          )}
        >
          {user.username[0]}
        </span>
        <span className="max-w-[140px] truncate text-sm">{user.username}</span>
      </button>
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
    </>
  )
}
