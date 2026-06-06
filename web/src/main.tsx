import 'clipboard-polyfill/overwrite-globals'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { AuthProvider } from './contexts/AuthContext'
import './lib/i18n'
import './components/dialogs/registry'
import './index.css'
import { installChunkReload } from './lib/chunk-reload'
import { installHost } from './lib/host'
import { loadExternalPlugins } from './lib/plugin-loader'
import { registerBuiltinPlugins } from './plugins'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

async function boot() {
  installChunkReload()
  installHost()
  registerBuiltinPlugins()
  await loadExternalPlugins()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark">
          <BrowserRouter>
            <AuthProvider>
              <TooltipProvider>
                <App />
                <Toaster />
              </TooltipProvider>
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void boot()
