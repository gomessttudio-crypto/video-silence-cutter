'use client'

import { useEffect, useRef, useState } from 'react'
import type { SilenceSegment } from '@/lib/types'

interface VideoPreviewProps {
  blobUrl: string | null
  silences?: SilenceSegment[]
}

export default function VideoPreview({ blobUrl, silences }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [skipEnabled, setSkipEnabled] = useState(false)
  const hasSilences = silences && silences.length > 0

  useEffect(() => {
    const video = videoRef.current
    if (!video || !skipEnabled || !silences || silences.length === 0) return

    function handleTimeUpdate() {
      const t = video!.currentTime
      const hit = silences!.find(s => t >= s.start && t < s.end)
      if (hit) {
        video!.currentTime = hit.end
      }
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [skipEnabled, silences])

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center h-40 bg-gray-900 rounded-xl border border-gray-800">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Carregando preview...
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={blobUrl}
        controls
        className="w-full rounded-xl bg-black"
        style={{ maxHeight: '360px' }}
      />
      {hasSilences && (
        <div className="absolute top-3 right-3">
          <button
            onClick={() => setSkipEnabled(v => !v)}
            title={skipEnabled ? 'Desativar simulação de cortes' : 'Ativar simulação de cortes'}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${skipEnabled
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-gray-900/80 text-gray-300 hover:bg-gray-800 border border-gray-700'
              }
            `}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
            {skipEnabled ? 'Simulando cortes' : 'Simular cortes'}
          </button>
        </div>
      )}
    </div>
  )
}
