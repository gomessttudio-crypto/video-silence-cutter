'use client'

import { useEffect, useRef } from 'react'
import type { JobStatus, SilenceSegment } from '@/lib/types'

interface ProcessingProgressProps {
  jobId: string
  onDetected: (result: {
    totalDuration: number
    silences: SilenceSegment[]
    rawSilences: SilenceSegment[]
  }) => void
  onDone: () => void
  onError: (message: string) => void
}

const STATUS_LABELS: Record<JobStatus, string> = {
  uploading:  'Enviando vídeo...',
  detecting:  'Detectando silêncios...',
  detected:   'Silêncios detectados!',
  cutting:    'Aplicando cortes...',
  done:       'Concluído!',
  error:      'Erro no processamento.',
}

export default function ProcessingProgress({ jobId, onDetected, onDone, onError }: ProcessingProgressProps) {
  const progressRef = useRef<HTMLDivElement>(null)
  const progressValueRef = useRef<HTMLSpanElement>(null)
  const statusTextRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const source = new EventSource(`/api/progress?id=${jobId}`)
    let receivedTerminal = false

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)

        if (progressRef.current) {
          progressRef.current.style.width = `${data.progress}%`
        }
        if (progressValueRef.current) {
          progressValueRef.current.textContent = `${data.progress}%`
        }
        if (statusTextRef.current) {
          statusTextRef.current.textContent = STATUS_LABELS[data.status as JobStatus] ?? data.status
        }

        if (data.status === 'detected') {
          receivedTerminal = true
          source.close()
          onDetected({
            totalDuration: data.totalDuration,
            silences: data.silences ?? [],
            rawSilences: data.rawSilences ?? [],
          })
        } else if (data.status === 'done') {
          receivedTerminal = true
          source.close()
          onDone()
        } else if (data.status === 'error') {
          receivedTerminal = true
          source.close()
          onError(data.error ?? 'Erro desconhecido no processamento.')
        }
      } catch {}
    }

    source.onerror = () => {
      if (!receivedTerminal) {
        source.close()
        onError('Conexão com o servidor perdida. Tente novamente.')
      }
    }

    return () => source.close()
  }, [jobId, onDetected, onDone, onError])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <p ref={statusTextRef} className="text-gray-400">
          {STATUS_LABELS.detecting}
        </p>
        <span ref={progressValueRef} className="text-gray-300 font-mono font-semibold">
          0%
        </span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
        <div
          ref={progressRef}
          className="h-full bg-blue-500 transition-all duration-300 rounded-full"
          style={{ width: '0%' }}
        />
      </div>
    </div>
  )
}
