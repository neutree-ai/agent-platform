import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api/client'
import { isCommitEnter } from '@/lib/keyboard'
import { cn } from '@/lib/utils'
import { Check, ChevronsUpDown, Loader2, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// ── Model Combobox ──

function ModelCombobox({
  value,
  onChange,
  models,
  loading,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  models: { id: string; name: string }[]
  loading: boolean
  placeholder?: string
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          // biome-ignore lint/a11y/useSemanticElements: shadcn combobox pattern, not a native <select>
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between text-xs font-normal focus:ring-inset', className)}
        >
          <span className="truncate">
            {value || placeholder || t('components.modelPicker.placeholders.selectModel')}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('components.modelPicker.placeholders.searchOrType')}
            className="h-8 text-xs"
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (isCommitEnter(e) && search && !models.some((m) => m.id === search)) {
                onChange(search)
                setOpen(false)
              }
            }}
          />
          <CommandList className="max-h-[200px]">
            {loading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
                {t('components.modelPicker.states.loading')}
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {search ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => {
                        onChange(search)
                        setOpen(false)
                      }}
                    >
                      {t('components.modelPicker.actions.useValue', { value: search })}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t('components.modelPicker.empty.noModels')}
                    </span>
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {models
                    .filter(
                      (m) =>
                        !search ||
                        m.id.toLowerCase().includes(search.toLowerCase()) ||
                        m.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.id}
                        onSelect={() => {
                          onChange(m.id)
                          setOpen(false)
                          setSearch('')
                        }}
                        className="text-xs"
                      >
                        <Check
                          className={cn(
                            'h-3 w-3 mr-1',
                            value === m.id ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="truncate">
                          {m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ── Model Input: combobox when provider selected, plain input otherwise ──

export function ModelInput({
  value,
  onChange,
  providerId,
  models,
  modelsLoading,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  providerId: string
  models: { id: string; name: string }[]
  modelsLoading: boolean
  placeholder?: string
  className?: string
}) {
  if (providerId) {
    return (
      <ModelCombobox
        value={value}
        onChange={onChange}
        models={models}
        loading={modelsLoading}
        placeholder={placeholder}
        className={className}
      />
    )
  }
  return (
    <Input
      className={cn('text-xs focus-visible:ring-inset', className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  )
}

// ── Test Button ──

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

/** Drives a provider connectivity test; lets the button and its result render
 * in separate layout slots so a long error can claim its own full-width row. */
export function useProviderTest(providerId: string, model: string) {
  const { t } = useTranslation()
  const [state, setState] = useState<TestState>('idle')
  const [detail, setDetail] = useState('')

  const run = useCallback(async () => {
    setState('testing')
    setDetail('')
    try {
      const res = await api.testProvider(providerId, model || undefined)
      setState(res.ok ? 'ok' : 'fail')
      setDetail(res.detail || '')
    } catch (e: any) {
      setState('fail')
      setDetail(e.message || t('common.errors.requestFailed'))
    }
  }, [providerId, model, t])

  return { state, detail, run }
}

export function TestButton({
  providerId,
  state,
  onRun,
  className,
}: { providerId: string; state: TestState; onRun: () => void; className?: string }) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('h-7 text-xs gap-1', className)}
      onClick={onRun}
      disabled={!providerId || state === 'testing'}
    >
      {state === 'testing' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Zap className="h-3 w-3" />
      )}
      {t('components.modelPicker.actions.test')}
    </Button>
  )
}

/** Full-width result line shown below the model row so long error text wraps
 * instead of squeezing the model field. */
export function TestResult({ state, detail }: { state: TestState; detail: string }) {
  const { t } = useTranslation()
  if (state === 'ok') {
    return (
      <p className="text-xs text-success">{t('components.modelPicker.status.connected')}</p>
    )
  }
  if (state === 'fail') {
    return (
      <p className="text-xs text-destructive break-words">
        {detail || t('components.modelPicker.status.failed')}
      </p>
    )
  }
  return null
}

// ── Hook: fetch models for a provider ──

export function useProviderModels(providerId: string) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!providerId) {
      setModels([])
      return
    }
    setLoading(true)
    api
      .listProviderModels(providerId)
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setLoading(false))
  }, [providerId])

  return { models, loading }
}
