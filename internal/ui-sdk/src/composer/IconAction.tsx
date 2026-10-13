import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** Icon-only button whose accessible name doubles as its tooltip. */
export function IconAction({
  label,
  tooltip = label,
  variant = 'ghost',
  className = 'h-7 w-7',
  children,
  ...props
}: Omit<ButtonProps, 'size' | 'type' | 'aria-label'> & { label: string; tooltip?: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="icon"
          className={className}
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
