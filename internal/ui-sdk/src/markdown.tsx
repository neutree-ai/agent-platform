// Markdown is host-injectable. The platform's own markdown renderer is deeply
// coupled to the app (workspace file links, skills paths, router) and can't be
// bundled, so the SDK ships a lean default and lets a host inject a richer one
// via <MarkdownProvider>. MC uses the default (or injects its own); the main
// app injects its full renderer to keep workspace-file linkification.
import { type ReactNode, createContext, useContext } from 'react'
import { cn } from './lib/utils'

export interface MarkdownProps {
  children: string
  className?: string
  // Accepted for parity with the app's renderer; the lean default ignores them.
  mode?: 'streaming' | 'static'
  linkifyWorkspaceFiles?: boolean
}

export type MarkdownComponent = (props: MarkdownProps) => ReactNode

// Lean default: preserve whitespace/wrapping. Good enough to read agent output;
// hosts that want real markdown inject their own component.
function DefaultMarkdown({ children, className }: MarkdownProps): ReactNode {
  return (
    <div className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed', className)}>
      {children}
    </div>
  )
}

const MarkdownContext = createContext<MarkdownComponent>(DefaultMarkdown)

export const MarkdownProvider = MarkdownContext.Provider

export function useMarkdown(): MarkdownComponent {
  return useContext(MarkdownContext)
}

/** Resolves the active markdown renderer (host-injected or lean default). */
export function Markdown(props: MarkdownProps): ReactNode {
  const Impl = useMarkdown()
  return <Impl {...props} />
}
