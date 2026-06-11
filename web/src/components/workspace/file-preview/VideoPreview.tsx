interface VideoPreviewProps {
  /** URL streaming the raw video bytes. */
  src: string
  filename: string
}

export function VideoPreview({ src, filename }: VideoPreviewProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-4">
      {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded media has no caption track */}
      <video
        key={src}
        src={src}
        controls
        controlsList="nodownload"
        preload="metadata"
        aria-label={filename}
        className="max-h-full max-w-full rounded"
      />
    </div>
  )
}
