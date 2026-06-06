import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Mic, Square, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type State = 'idle' | 'recording' | 'transcribing'

export interface VoiceInputHandle {
  start: () => void
  stop: (cancel?: boolean) => void
}

interface VoiceInputButtonProps {
  onTranscribed: (text: string) => void
  onError?: (message: string) => void
  onStateChange?: (state: State) => void
  disabled?: boolean
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const VoiceInputButton = forwardRef<VoiceInputHandle, VoiceInputButtonProps>(
  function VoiceInputButton({ onTranscribed, onError, onStateChange, disabled }, ref) {
    const { t } = useTranslation()
    const [state, setStateRaw] = useState<State>('idle')
    const [seconds, setSeconds] = useState(0)
    const onStateChangeRef = useRef(onStateChange)
    onStateChangeRef.current = onStateChange

    const setState = (next: State) => {
      setStateRaw(next)
      onStateChangeRef.current?.(next)
    }

    const recorderRef = useRef<MediaRecorder | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const streamRef = useRef<MediaStream | null>(null)
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const cancelledRef = useRef(false)

    const stopStream = () => {
      const tracks = streamRef.current?.getTracks() ?? []
      for (const track of tracks) track.stop()
      streamRef.current = null
    }

    const clearTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    // Cleanup on unmount in case user navigates away mid-recording. Refs are
    // stable across renders, so this effect only needs to run once.
    // biome-ignore lint/correctness/useExhaustiveDependencies: refs only
    useEffect(() => {
      return () => {
        clearTimer()
        stopStream()
        try {
          if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
        } catch {
          // ignore
        }
      }
    }, [])

    const reportError = (msg: string) => {
      if (onError) onError(msg)
      else alert(msg)
    }

    const startRecording = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        reportError(t('components.voiceInput.errors.unsupported'))
        return
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        reportError(t('components.voiceInput.errors.permissionDenied'))
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

        if (cancelledRef.current) {
          setState('idle')
          return
        }

        setState('transcribing')
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })
        try {
          const form = new FormData()
          form.append('audio', blob, 'audio.webm')
          const res = await fetch('/api/asr/transcribe', {
            method: 'POST',
            body: form,
            credentials: 'include',
          })
          if (!res.ok) {
            const err = await res
              .json()
              .catch(() => ({ error: t('components.voiceInput.errors.failed') }))
            throw new Error(err.error || t('components.voiceInput.errors.failed'))
          }
          const data = (await res.json()) as { text: string }
          if (data.text?.trim()) onTranscribed(data.text.trim())
        } catch (e) {
          reportError((e as Error).message)
        } finally {
          setState('idle')
        }
      }

      recorder.start()
      recorderRef.current = recorder
      setSeconds(0)
      setState('recording')
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    }

    const stopRecording = (cancel: boolean) => {
      cancelledRef.current = cancel
      clearTimer()
      try {
        recorderRef.current?.stop()
      } catch {
        stopStream()
        setState('idle')
      }
    }

    useImperativeHandle(ref, () => ({
      start: () => {
        if (state === 'idle' && !disabled) startRecording()
      },
      stop: (cancel = false) => {
        if (state === 'recording') stopRecording(cancel)
      },
    }))

    const modifier = navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'

    if (state === 'idle') {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={startRecording}
              disabled={disabled}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('components.voiceInput.actions.start', { modifier })}</TooltipContent>
        </Tooltip>
      )
    }

    if (state === 'recording') {
      return (
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-primary/80 hover:text-primary"
                onClick={() => stopRecording(false)}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('components.voiceInput.actions.stopAndTranscribe')}</TooltipContent>
          </Tooltip>
          <span className="flex items-center gap-1 text-tiny text-muted-foreground tabular-nums">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary/80" />
            {fmtTime(seconds)}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => stopRecording(true)}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('components.voiceInput.actions.cancel')}</TooltipContent>
          </Tooltip>
        </div>
      )
    }

    // transcribing
    return (
      <div className="flex items-center gap-1.5 px-1">
        <Spinner size="sm" />
        <span className="text-tiny text-muted-foreground">
          {t('components.voiceInput.actions.transcribing')}
        </span>
      </div>
    )
  },
)
