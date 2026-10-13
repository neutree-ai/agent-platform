import { Mic, Square, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSdkTranslation } from '../i18n'
import { cn } from '../lib/utils'
import { Spinner } from '../ui/spinner'
import { IconAction } from './IconAction'
import { modifierLabel } from './keys'
import type { ComposerVoice } from './types'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * MediaRecorder lifecycle: record → (stop | cancel) → transcribe → idle.
 * `stop(true)` discards the recording without transcribing.
 */
export function useVoiceRecorder({
  voice,
  onText,
}: {
  voice: ComposerVoice | undefined
  onText: (text: string) => void
}) {
  const { t } = useSdkTranslation()
  const [state, setState] = useState<VoiceState>('idle')
  const [seconds, setSeconds] = useState(0)
  const latest = useRef({ voice, onText, t })
  latest.current = { voice, onText, t }

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)
  const stateRef = useRef<VoiceState>('idle')
  stateRef.current = state

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Release the microphone if the composer unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimer()
      stopStream()
      cancelledRef.current = true
      try {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      } catch {
        // ignore
      }
    }
  }, [clearTimer, stopStream])

  const reportError = useCallback((message: string) => {
    const onError = latest.current.voice?.onError
    if (onError) onError(message)
    else window.alert(message)
  }, [])

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return
    const { t } = latest.current
    if (!navigator.mediaDevices?.getUserMedia) {
      reportError(t('components.composer.voice.errors.unsupported'))
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      reportError(t('components.composer.voice.errors.permissionDenied'))
      return
    }
    streamRef.current = stream
    chunksRef.current = []
    cancelledRef.current = false

    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = async () => {
      stopStream()
      clearTimer()
      const chunks = chunksRef.current
      chunksRef.current = []
      recorderRef.current = null
      if (cancelledRef.current) {
        setState('idle')
        return
      }
      setState('transcribing')
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      try {
        const transcribe = latest.current.voice?.transcribe
        if (!transcribe)
          throw new Error(latest.current.t('components.composer.voice.errors.failed'))
        const text = (await transcribe(blob)).trim()
        if (text) latest.current.onText(text)
      } catch (e) {
        reportError(
          (e as Error)?.message || latest.current.t('components.composer.voice.errors.failed'),
        )
      } finally {
        setState('idle')
      }
    }

    recorder.start()
    recorderRef.current = recorder
    setSeconds(0)
    setState('recording')
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
  }, [clearTimer, reportError, stopStream])

  const stop = useCallback(
    (cancel = false) => {
      if (stateRef.current !== 'recording') return
      cancelledRef.current = cancel
      clearTimer()
      try {
        recorderRef.current?.stop()
      } catch {
        stopStream()
        setState('idle')
      }
    },
    [clearTimer, stopStream],
  )

  return { state, seconds, start, stop }
}

/** Toolbar control: mic → (stop, timer, cancel) → transcribing. */
export function VoiceControl({
  state,
  seconds,
  disabled,
  shortcut,
  onStart,
  onStop,
}: {
  state: VoiceState
  seconds: number
  disabled?: boolean
  shortcut?: boolean
  onStart: () => void
  onStop: (cancel: boolean) => void
}) {
  const { t } = useSdkTranslation()

  if (state === 'idle') {
    return (
      <IconAction
        label={t('components.composer.voice.actions.start')}
        tooltip={
          shortcut
            ? t('components.composer.voice.actions.startWithShortcut', {
                modifier: modifierLabel(),
              })
            : undefined
        }
        onClick={onStart}
        disabled={disabled}
      >
        <Mic className="h-4 w-4" />
      </IconAction>
    )
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-1">
        <IconAction
          label={t('components.composer.voice.actions.stopAndTranscribe')}
          className="h-7 w-7 text-primary/80 hover:text-primary"
          onClick={() => onStop(false)}
        >
          <Square className="h-3.5 w-3.5 fill-current" />
        </IconAction>
        <span className="flex items-center gap-1 text-tiny tabular-nums text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary/80" />
          {fmtTime(seconds)}
        </span>
        <IconAction
          label={t('components.composer.voice.actions.cancel')}
          onClick={() => onStop(true)}
        >
          <X className="h-4 w-4" />
        </IconAction>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 px-1">
      <Spinner size="sm" />
      <span className="text-tiny text-muted-foreground">
        {t('components.composer.voice.states.transcribing')}
      </span>
    </div>
  )
}

// One full animation shorthand per bar (the delay is part of it, so no
// separate animation-delay utility can be reordered ahead of the shorthand).
// Staggered offsets give the equalizer an organic, asymmetric pulse.
const EQ_BARS = [
  '[animation:composer-voice-eq_1.1s_ease-in-out_-0.4s_infinite]',
  '[animation:composer-voice-eq_1.1s_ease-in-out_-0.1s_infinite]',
  '[animation:composer-voice-eq_1.1s_ease-in-out_-0.7s_infinite]',
  '[animation:composer-voice-eq_1.1s_ease-in-out_-0.25s_infinite]',
  '[animation:composer-voice-eq_1.1s_ease-in-out_-0.55s_infinite]',
]

// The keyframes ship with the component so hosts need no Tailwind theme entry.
const EQ_KEYFRAMES =
  '@keyframes composer-voice-eq{0%,100%{transform:scaleY(0.3)}50%{transform:scaleY(1)}}'

/** Overlay that fills the textarea's box while recording / transcribing. */
export function VoiceCapturePanel({ state }: { state: 'recording' | 'transcribing' }) {
  const { t } = useSdkTranslation()
  const label =
    state === 'recording'
      ? t('components.composer.voice.states.listening')
      : t('components.composer.voice.states.transcribing')

  return (
    <output
      aria-live="polite"
      className={cn(
        // Fills the textarea's box exactly so swapping is height-stable.
        'absolute inset-0 flex items-center gap-2.5 px-3 text-xs',
        'bg-gradient-to-br from-primary/[0.18] via-info/[0.12] to-primary/[0.06]',
      )}
    >
      <style>{EQ_KEYFRAMES}</style>
      {/* Soft radial highlight in the upper-right — depth without animation. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_-30%,oklch(var(--info)/0.22),transparent_55%)]"
      />
      <div aria-hidden className="relative flex h-4 items-center gap-[3px]">
        {EQ_BARS.map((animation) => (
          <span
            key={animation}
            className={cn('block h-3 w-[2px] origin-center rounded-full bg-primary/80', animation)}
          />
        ))}
      </div>
      <span className="relative font-medium tracking-wide text-foreground/85">{label}</span>
    </output>
  )
}
