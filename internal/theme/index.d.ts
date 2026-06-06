export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

// Components and hooks are typed loosely as `any` so that consumers don't
// need to resolve React/sonner/lucide-react from this package's directory.
// Runtime is provided by `src/index.ts` via a bundler alias.
export const ThemeProvider: any
export function useTheme(): ThemeContextValue
export function useResolvedTheme(): ResolvedTheme
export const ThemedToaster: any
export const ThemeToggle: any
