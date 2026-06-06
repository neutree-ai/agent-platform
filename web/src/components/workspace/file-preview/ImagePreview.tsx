import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Zoom from 'react-medium-image-zoom'
import 'react-medium-image-zoom/dist/styles.css'

interface ImagePreviewProps {
  src: string
  filename: string
  /** When non-null, renders a "previous" overlay button. */
  onPrev?: (() => void) | null
  /** When non-null, renders a "next" overlay button. */
  onNext?: (() => void) | null
}

export function ImagePreview({ src, filename, onPrev, onNext }: ImagePreviewProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="relative flex items-center justify-center p-4">
        <Zoom>
          <img
            src={src}
            alt={filename}
            className="max-w-full max-h-[80vh] object-contain rounded"
          />
        </Zoom>
        {onPrev && (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/70 text-foreground/80 backdrop-blur transition hover:bg-background/90 hover:text-foreground shadow-sm"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next image"
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/70 text-foreground/80 backdrop-blur transition hover:bg-background/90 hover:text-foreground shadow-sm"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </ScrollArea>
  )
}
