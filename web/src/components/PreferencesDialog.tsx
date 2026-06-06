import { useTheme } from '@/components/ThemeProvider'
import ChangePasswordDialog from '@/components/dialogs/ChangePasswordDialog'
import { NotificationConfig } from '@/components/preferences/NotificationConfig'
import { WallpaperPicker } from '@/components/preferences/WallpaperPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Markdown } from '@/components/ui/markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/AuthContext'
import { type PreferencesSection, getPreferencesDoc } from '@/docs/inline-help/preferences-docs'
import { useChatSendKey } from '@/hooks/useChatSendKey'
import { api } from '@/lib/api/client'
import { APP_VERSION } from '@/lib/version'
import {
  CornerDownLeft,
  KeyRound,
  Languages,
  Link,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  Settings2,
  Sparkles,
  Sun,
  Unlink,
  Volume2,
  VolumeOff,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

interface PreferencesDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface NavItem {
  key: PreferencesSection
  label: string
  badge?: string
}

export function PreferencesDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: PreferencesDialogProps = {}) {
  const { t, i18n } = useTranslation()
  const currentLang = (i18n.resolvedLanguage ?? i18n.language ?? 'en-US').startsWith('zh')
    ? 'zh-CN'
    : 'en-US'
  const { theme, setTheme } = useTheme()
  const { user, logout, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem('tos-sound-enabled') !== 'false',
  )
  const { mode: chatSendKey, setMode: setChatSendKey } = useChatSendKey()
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<PreferencesSection>('appearance')

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen

  function toggleSound() {
    setSoundEnabled((prev) => {
      const next = !prev
      localStorage.setItem('tos-sound-enabled', String(next))
      return next
    })
  }

  const [evolSaving, setEvolSaving] = useState(false)
  const autoEvolution = user?.auto_evolution ?? false

  // Linked accounts
  const [identities, setIdentities] = useState<{ provider: string; display_name: string | null }[]>(
    [],
  )
  const [identitiesLoaded, setIdentitiesLoaded] = useState(false)
  const [wecomEnabled, setWecomEnabled] = useState(false)
  const [unbinding, setUnbinding] = useState(false)

  useEffect(() => {
    if (!open || identitiesLoaded) return
    api
      .getIdentities()
      .then((ids) => {
        setIdentities(ids)
        setIdentitiesLoaded(true)
      })
      .catch(() => {})
    api
      .getWeComEnabled()
      .then((res) => setWecomEnabled(res.enabled))
      .catch(() => {})
  }, [open, identitiesLoaded])

  const wecomIdentity = identities.find((i) => i.provider === 'wecom')

  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const canChangePassword = user?.auth_source === 'password'

  async function handleWeComBind() {
    const { url } = await api.getWeComAuthorizeUrl('bind')
    window.location.href = url
  }

  async function handleWeComUnbind() {
    setUnbinding(true)
    try {
      await api.unbindWeCom()
      setIdentities((prev) => prev.filter((i) => i.provider !== 'wecom'))
    } finally {
      setUnbinding(false)
    }
  }

  // Reset active section when dialog opens
  useEffect(() => {
    if (open) setActiveSection('appearance')
  }, [open])

  const navItems = [
    { key: 'appearance', label: t('components.preferences.navigation.appearance') },
    false && { key: 'evolution' as const, label: t('components.preferences.navigation.evolution') },
    {
      key: 'notifications',
      label: t('components.preferences.navigation.notifications'),
      badge: 'ALPHA',
    },
    { key: 'accounts', label: t('components.preferences.navigation.accounts') },
    { key: 'about', label: t('components.preferences.navigation.about') },
  ].filter(Boolean) as NavItem[]

  const doc = getPreferencesDoc(activeSection)

  function renderSection() {
    switch (activeSection) {
      case 'appearance':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground">
                {t('components.preferences.theme.label')}
              </span>
              <div className="flex gap-1">
                {[
                  {
                    value: 'light' as const,
                    icon: Sun,
                    label: t('components.preferences.theme.options.light'),
                  },
                  {
                    value: 'dark' as const,
                    icon: Moon,
                    label: t('components.preferences.theme.options.dark'),
                  },
                  {
                    value: 'system' as const,
                    icon: Monitor,
                    label: t('components.preferences.theme.options.system'),
                  },
                ].map(({ value, icon: Icon, label }) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={theme === value ? 'default' : 'outline'}
                    className="h-6 gap-1 px-2 text-tiny"
                    onClick={() => setTheme(value)}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <WallpaperPicker />
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground">
                {t('components.preferences.sound.label')}
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={soundEnabled ? 'default' : 'outline'}
                  className="h-6 gap-1 px-2 text-tiny"
                  onClick={() => {
                    if (!soundEnabled) toggleSound()
                  }}
                >
                  <Volume2 className="h-3 w-3" />
                  {t('common.on')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!soundEnabled ? 'default' : 'outline'}
                  className="h-6 gap-1 px-2 text-tiny"
                  onClick={() => {
                    if (soundEnabled) toggleSound()
                  }}
                >
                  <VolumeOff className="h-3 w-3" />
                  {t('common.off')}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground">
                {t('components.preferences.language.label')}
              </span>
              <div className="flex gap-1">
                {[
                  {
                    value: 'zh-CN' as const,
                    label: t('components.preferences.language.options.zhCN'),
                  },
                  {
                    value: 'en-US' as const,
                    label: t('components.preferences.language.options.enUS'),
                  },
                ].map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={currentLang === value ? 'default' : 'outline'}
                    className="h-6 gap-1 px-2 text-tiny"
                    onClick={() => {
                      void i18n.changeLanguage(value)
                    }}
                  >
                    <Languages className="h-3 w-3" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground">
                {t('components.preferences.chatSendKey.label')}
              </span>
              <div className="flex gap-1">
                {[
                  {
                    value: 'mod-enter' as const,
                    label: t('components.preferences.chatSendKey.options.modEnter'),
                  },
                  {
                    value: 'enter' as const,
                    label: t('components.preferences.chatSendKey.options.enter'),
                  },
                ].map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={chatSendKey === value ? 'default' : 'outline'}
                    className="h-6 gap-1 px-2 text-tiny"
                    onClick={() => setChatSendKey(value)}
                  >
                    <CornerDownLeft className="h-3 w-3" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )

      case 'evolution':
        return (
          <div className="space-y-4">
            <button
              type="button"
              disabled={evolSaving}
              onClick={async () => {
                setEvolSaving(true)
                try {
                  await api.patchMe({ auto_evolution: !autoEvolution })
                  await refreshUser()
                } finally {
                  setEvolSaving(false)
                }
              }}
              className={`relative w-full overflow-hidden rounded-lg border p-4 text-left transition-colors ${
                autoEvolution
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-muted/30 hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                      autoEvolution
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      {t('components.preferences.autoEvolution.title')}
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      {t('components.preferences.autoEvolution.description')}
                    </div>
                  </div>
                </div>
                {evolSaving ? (
                  <Spinner size="sm" className="mt-1.5 h-4 w-4 shrink-0" />
                ) : (
                  <Switch
                    checked={autoEvolution}
                    onCheckedChange={() => {
                      /* handled by parent button */
                    }}
                    tabIndex={-1}
                    className="mt-0.5 shrink-0 pointer-events-none"
                  />
                )}
              </div>
            </button>
          </div>
        )

      case 'notifications':
        return <NotificationConfig />

      case 'accounts':
        return (
          <div className="space-y-4">
            {canChangePassword && (
              <div className="space-y-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('components.preferences.security.title')}
                </span>
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-2">
                    <KeyRound className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                    <div className="space-y-0.5">
                      <div className="text-xs text-foreground">
                        {t('components.preferences.security.password.label')}
                      </div>
                      <div className="text-mini text-muted-foreground leading-relaxed">
                        {t('components.preferences.security.password.description')}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-tiny"
                    onClick={() => setChangePasswordOpen(true)}
                  >
                    {t('components.preferences.security.password.action')}
                  </Button>
                </div>
              </div>
            )}
            {wecomEnabled && (
              <div className="space-y-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('components.preferences.accounts.title')}
                </span>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-foreground">
                      {t('components.preferences.accounts.wecom')}
                    </span>
                    {wecomIdentity && (
                      <span className="text-mini text-muted-foreground">
                        ({wecomIdentity.display_name})
                      </span>
                    )}
                  </div>
                  {wecomIdentity ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-tiny text-muted-foreground hover:text-destructive"
                      onClick={handleWeComUnbind}
                      disabled={unbinding}
                    >
                      {unbinding ? (
                        <Spinner size="sm" className="h-3 w-3" />
                      ) : (
                        <Unlink className="h-3 w-3" />
                      )}
                      {t('components.preferences.accounts.actions.unlink')}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-tiny"
                      onClick={handleWeComBind}
                    >
                      <Link className="h-3 w-3" />
                      {t('components.preferences.accounts.actions.link')}
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="border-t border-border pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  await logout()
                  navigate('/login')
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
                {t('components.preferences.actions.logout')}
              </Button>
            </div>
          </div>
        )

      case 'about':
        return <AboutSection />

      default:
        return null
    }
  }

  return (
    <>
      {!isControlled && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden"
          onClick={() => setOpen(true)}
          title={t('components.preferences.title')}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      )}

      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-6xl p-0 flex flex-col h-[70vh] overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="text-sm">{t('components.preferences.title')}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-1 min-h-0 min-w-0 border-t border-border mt-3">
            {/* Left nav */}
            <div className="w-40 border-r border-border flex flex-col gap-0.5 p-2 shrink-0">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`text-xs px-3 py-1.5 rounded-md text-left transition-colors ${
                    activeSection === item.key
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                  onClick={() => setActiveSection(item.key)}
                >
                  {item.label}
                  {item.badge && (
                    <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.5 text-micro font-semibold text-primary">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Center content */}
            <ScrollArea className="flex-1 min-h-0 border-r border-border">
              <div className="p-4">{renderSection()}</div>
            </ScrollArea>

            {/* Right docs */}
            <ScrollArea className="w-80 min-h-0 shrink-0">
              <div className="px-4 py-4">
                <Markdown
                  key={activeSection}
                  className="text-xs [&_h2]:text-sm [&_h3]:text-xs [&_p]:text-xs [&_li]:text-xs [&_code]:text-tiny [&_td]:text-xs [&_th]:text-xs"
                >
                  {doc}
                </Markdown>
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AboutSection() {
  const { t } = useTranslation()
  const [serverCommit, setServerCommit] = useState<string | null>(null)
  const [serverBuiltAt, setServerBuiltAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api
      .getVersion()
      .then((v) => {
        if (cancelled) return
        setServerCommit(v.commit)
        setServerBuiltAt(v.builtAt)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const outdated = !loading && serverCommit && serverCommit !== APP_VERSION

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Row
          label={t('components.preferences.about.version')}
          value={loading ? '…' : (serverCommit ?? '—')}
          mono
        />
        {serverBuiltAt && (
          <Row label={t('components.preferences.about.releasedAt')} value={serverBuiltAt} mono />
        )}
      </div>
      {outdated && (
        <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2">
          <span className="text-xs text-foreground">
            {t('components.preferences.about.outdated')}
          </span>
          <Button
            size="sm"
            variant="default"
            className="h-6 px-2 text-tiny"
            onClick={() => window.location.reload()}
          >
            {t('components.preferences.about.reload')}
          </Button>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-xs text-foreground truncate ${mono ? 'font-mono text-tiny' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
