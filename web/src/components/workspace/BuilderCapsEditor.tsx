import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BUILDER_CAPS, type BuilderCap, parseBuilderHeader } from '@neutree-ai/types'

/**
 * Builder Mode caps multi-select. Specific to the `tos-platform` MCP server;
 * not driven by the catalog `params` schema. Each cap toggles a group of MCP
 * tools the agent can use to propose changes.
 *
 * Cap set is owned by `internal/types/builder.ts` (shared with cp). Adding
 * a new cap: extend the union there, then add an i18n entry under
 * `components.mcpConfigEditor.builder.options.<cap>`.
 */
interface BuilderCapsEditorProps {
  /** Comma-separated cap list, e.g. "workspace,global". Empty when builder mode is off. */
  value: string
  onChange: (next: string) => void
}

export function BuilderCapsEditor({ value, onChange }: BuilderCapsEditorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = new Set<BuilderCap>(parseBuilderHeader(value))

  function toggle(cap: BuilderCap) {
    const next = new Set(selected)
    if (next.has(cap)) next.delete(cap)
    else next.add(cap)
    onChange(BUILDER_CAPS.filter((v) => next.has(v)).join(','))
  }

  function capLabel(cap: BuilderCap) {
    return t(`components.mcpConfigEditor.builder.options.${cap}.label`, { defaultValue: cap })
  }
  function capDesc(cap: BuilderCap) {
    return t(`components.mcpConfigEditor.builder.options.${cap}.description`, {
      defaultValue: '',
    })
  }

  const summary = (() => {
    if (selected.size === 0) return t('components.mcpConfigEditor.builder.none')
    if (selected.size === 1) return capLabel([...selected][0])
    return t('components.mcpConfigEditor.builder.nSelected', { count: selected.size })
  })()

  return (
    <div className="flex items-center gap-2">
      <span className="text-tiny text-muted-foreground w-24">
        {t('components.mcpConfigEditor.builder.title')}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            // biome-ignore lint/a11y/useSemanticElements: shadcn combobox pattern, not a native <select>
            role="combobox"
            aria-expanded={open}
            className="h-6 flex-1 justify-between text-tiny font-normal px-2"
          >
            <span className={cn('truncate', selected.size === 0 && 'text-muted-foreground')}>
              {summary}
            </span>
            <ChevronsUpDown className="ml-2 h-2.5 w-2.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] min-w-[16rem] overflow-hidden p-0"
          align="start"
        >
          <Command>
            <CommandList className="max-h-60 overflow-y-auto">
              <CommandEmpty className="py-3 text-tiny text-muted-foreground">
                {t('components.mcpConfigEditor.builder.empty')}
              </CommandEmpty>
              <CommandGroup>
                {BUILDER_CAPS.map((cap) => {
                  const isOn = selected.has(cap)
                  const desc = capDesc(cap)
                  return (
                    <CommandItem
                      key={cap}
                      value={capLabel(cap)}
                      onSelect={() => toggle(cap)}
                      className="items-start gap-2 text-tiny"
                    >
                      <Check
                        className={cn(
                          'mt-0.5 h-3 w-3 shrink-0',
                          isOn ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-foreground">{capLabel(cap)}</span>
                        {desc && (
                          <span className="text-mini text-muted-foreground/70 whitespace-normal">
                            {desc}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
