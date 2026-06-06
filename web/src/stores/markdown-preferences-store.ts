import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface MarkdownPreferencesState {
  tocVisible: boolean
  setTocVisible: (visible: boolean) => void
}

export const useMarkdownPreferencesStore = create<MarkdownPreferencesState>()(
  persist(
    (set) => ({
      tocVisible: false,
      setTocVisible: (tocVisible) => set({ tocVisible }),
    }),
    { name: 'tos-markdown-prefs' },
  ),
)
