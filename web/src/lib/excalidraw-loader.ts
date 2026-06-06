/**
 * Runtime loader for the pre-bundled excalidraw ESM.
 *
 * The bundle lives in public/excalidraw-assets/excalidraw.mjs and expects
 * React / ReactDOM / JSX-runtime to be available as globals. We set those
 * before the first import so the bundle shares the app's React instance.
 */
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as JSXRuntime from 'react/jsx-runtime'

declare global {
  interface Window {
    __EXCALIDRAW_REACT__: typeof React
    __EXCALIDRAW_REACT_DOM__: typeof ReactDOM
    __EXCALIDRAW_JSX_RUNTIME__: typeof JSXRuntime
  }
}

let loaded: Promise<typeof import('@excalidraw/excalidraw')> | null = null

export function loadExcalidraw() {
  if (!loaded) {
    // Set globals — must happen before the dynamic import
    window.__EXCALIDRAW_REACT__ = React
    window.__EXCALIDRAW_REACT_DOM__ = ReactDOM
    window.__EXCALIDRAW_JSX_RUNTIME__ = JSXRuntime

    // Inject CSS
    if (!document.querySelector('link[data-excalidraw-css]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = '/excalidraw-assets/excalidraw.css'
      link.dataset.excalidrawCss = ''
      document.head.appendChild(link)
    }

    // Fetch → blob URL → dynamic import. The bundle lives in /public so it's
    // served as-is, but Vite's dev server refuses module imports that resolve
    // into /public. Going through a blob URL hides the import from Vite's
    // import analysis entirely, and works identically in prod.
    loaded = fetch('/excalidraw-assets/excalidraw.mjs')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch excalidraw bundle: ${r.status}`)
        return r.blob()
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(new Blob([blob], { type: 'text/javascript' }))
        return import(/* @vite-ignore */ blobUrl) as Promise<
          typeof import('@excalidraw/excalidraw')
        >
      })
  }
  return loaded
}
