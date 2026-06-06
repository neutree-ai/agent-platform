interface HtmlPreviewProps {
  content: string
  filename: string
}

/**
 * Renders an HTML file as a live page inside a sandboxed iframe.
 *
 * Uses `srcDoc` (not `src`): the content FileViewer already fetched is reused
 * directly — no second request, no auth question. The `sandbox` attribute
 * without `allow-same-origin` forces the document into an opaque origin, so a
 * script in the file can't reach the NAP app's DOM, cookies or `/api`.
 * `allow-scripts` keeps interactive reports (charts, etc.) working.
 *
 * Caveat: relative resources (`./style.css`, `<img src="logo.png">`) won't
 * resolve — the document URL is `about:srcdoc`, not the file's directory.
 * Self-contained single-file HTML previews correctly; multi-file sites need
 * the source view.
 */
export function HtmlPreview({ content, filename }: HtmlPreviewProps) {
  return (
    <iframe
      srcDoc={content}
      title={filename}
      sandbox="allow-scripts"
      className="min-h-0 flex-1 border-0 bg-white"
    />
  )
}
