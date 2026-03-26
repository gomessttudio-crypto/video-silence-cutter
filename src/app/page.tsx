'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import UploadArea from '@/components/UploadArea'
import DetectionSettings from '@/components/DetectionSettings'
import ProcessingProgress from '@/components/ProcessingProgress'
import VideoPreview from '@/components/VideoPreview'
import CutTimeline from '@/components/CutTimeline'
import FormatSelector from '@/components/FormatSelector'
import DownloadButton from '@/components/DownloadButton'
import { DEFAULT_DETECTION } from '@/lib/types'
import type { DetectionOptions, OutputFormat, SilenceSegment } from '@/lib/types'
import { mergeSilences, applyPadding } from '@/lib/silence-utils'

type AppState = 'idle' | 'detecting' | 'detected' | 'cutting' | 'done' | 'error'

interface DetectionResult {
  totalDuration: number
  silences: SilenceSegment[]
}

export default function Home() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [detection, setDetection] = useState<DetectionOptions>({ ...DEFAULT_DETECTION })
  const [format, setFormat] = useState<OutputFormat>('mp4')
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [noSilencesWarning, setNoSilencesWarning] = useState(false)
  const [isStartingCut, setIsStartingCut] = useState(false)

  // Blob URL do vídeo original (criado localmente quando arquivo é selecionado)
  const [originalVideoBlobUrl, setOriginalVideoBlobUrl] = useState<string | null>(null)
  // Blob URL do vídeo cortado (após o corte)
  const [cutVideoBlobUrl, setCutVideoBlobUrl] = useState<string | null>(null)
  // Arquivo de áudio original para waveform
  const [audioFile, setAudioFile] = useState<File | null>(null)

  // rawSilences: silêncios brutos do FFmpeg (antes de merge/padding)
  const [rawSilences, setRawSilences] = useState<SilenceSegment[]>([])
  // autoSilences: silêncios calculados automaticamente (sem overrides manuais)
  const [autoSilences, setAutoSilences] = useState<SilenceSegment[]>([])
  // computedSilences: silêncios calculados com as configurações atuais (o que a timeline exibe)
  const [computedSilences, setComputedSilences] = useState<SilenceSegment[]>([])
  // true se o usuário editou manualmente a timeline
  const [hasManualOverrides, setHasManualOverrides] = useState(false)
  // true enquanto aguarda resposta do servidor em uma redetecção
  const [isRedetecting, setIsRedetecting] = useState(false)

  const redetectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formatAtCut = useRef<OutputFormat>('mp4')

  // Arquivo selecionado → cria blob URL local para preview imediato
  const handleFileSelected = useCallback((blobUrl: string, file: File) => {
    setOriginalVideoBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return blobUrl })
    setAudioFile(file)
  }, [])

  const handleJobStart = useCallback((id: string) => {
    setJobId(id)
    setAppState('detecting')
    setDetectionResult(null)
    setErrorMsg(null)
    setNoSilencesWarning(false)
    setRawSilences([])
    setAutoSilences([])
    setComputedSilences([])
    setHasManualOverrides(false)
    setIsRedetecting(false)
    setCutVideoBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
  }, [])

  const handleDetected = useCallback((res: { totalDuration: number; silences: SilenceSegment[]; rawSilences: SilenceSegment[] }) => {
    setDetectionResult({ totalDuration: res.totalDuration, silences: res.silences })
    setRawSilences(res.rawSilences)
    setAutoSilences(res.silences)
    setComputedSilences(res.silences)
    setHasManualOverrides(false)
    setAppState('detected')
    if (res.silences.length === 0) setNoSilencesWarning(true)
  }, [])

  const handleCut = useCallback(async () => {
    if (!jobId) return
    formatAtCut.current = format
    setIsStartingCut(true)
    try {
      const res = await fetch('/api/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, silences: computedSilences }),
      })
      if (!res.ok) throw new Error('Erro ao iniciar corte')
      // Só muda o estado DEPOIS que o servidor confirmou que o job está em 'cutting'
      // Isso garante que o SSE vai encontrar status='cutting' na primeira poll
      setAppState('cutting')
    } catch (err) {
      setErrorMsg(String(err))
      setAppState('error')
    } finally {
      setIsStartingCut(false)
    }
  }, [jobId, computedSilences, format])

  const handleCutDone = useCallback(() => {
    setAppState('done')
    const fmt = formatAtCut.current
    fetch(`/api/download?id=${jobId}&format=${fmt}`)
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar vídeo')
        return r.blob()
      })
      .then((blob) => {
        setCutVideoBlobUrl(URL.createObjectURL(blob))
      })
      .catch((err) => {
        setErrorMsg(err.message)
        setAppState('error')
      })
  }, [jobId])

  const handleError = useCallback((msg: string) => {
    setErrorMsg(msg)
    setAppState('error')
  }, [])

  const handleReset = useCallback(() => {
    setOriginalVideoBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setCutVideoBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setAudioFile(null)
    setAppState('idle')
    setJobId(null)
    setDetectionResult(null)
    setErrorMsg(null)
    setNoSilencesWarning(false)
    setRawSilences([])
    setAutoSilences([])
    setComputedSilences([])
    setHasManualOverrides(false)
    setIsRedetecting(false)
    if (redetectDebounceRef.current) clearTimeout(redetectDebounceRef.current)
  }, [])

  // Effect 1: padding e removeShortSpikes — recalculo client-side instantâneo
  useEffect(() => {
    if (appState !== 'detected' || rawSilences.length === 0) return
    const merged = mergeSilences(rawSilences, detection.removeShortSpikes)
    const padded = applyPadding(merged, detection.paddingLeft, detection.paddingRight)
    setAutoSilences(padded)
    setHasManualOverrides(false)
    setComputedSilences(padded)
    setNoSilencesWarning(padded.length === 0)
  }, [detection.paddingLeft, detection.paddingRight, detection.removeShortSpikes, rawSilences, appState])

  // Effect 2: threshold e minDuration — redetecção server-side com debounce
  useEffect(() => {
    if (appState !== 'detected' || !jobId) return
    if (redetectDebounceRef.current) clearTimeout(redetectDebounceRef.current)
    redetectDebounceRef.current = setTimeout(async () => {
      setIsRedetecting(true)
      try {
        const res = await fetch('/api/redetect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, ...detection }),
        })
        if (res.status === 410 || !res.ok) return
        const data = await res.json()
        setRawSilences(data.rawSilences ?? [])
        setHasManualOverrides(false)
        // Effect 1 dispara automaticamente quando rawSilences mudar
      } catch {} finally {
        setIsRedetecting(false)
      }
    }, 800)
  }, [detection.threshold, detection.minDuration, appState, jobId])

  const handleTimelineEdit = useCallback((newSilences: SilenceSegment[]) => {
    setComputedSilences(newSilences)
    setHasManualOverrides(true)
    setNoSilencesWarning(newSilences.length === 0)
  }, [])

  const handleResetOverrides = useCallback(() => {
    setComputedSilences(autoSilences)
    setHasManualOverrides(false)
    setNoSilencesWarning(autoSilences.length === 0)
  }, [autoSilences])

  const isProcessing = appState === 'detecting' || appState === 'cutting'

  return (
    <main className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-100">Video Silence Cutter</h1>
            <p className="text-xs text-gray-500">Remove silêncios automaticamente</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
        {/* Coluna principal */}
        <div className="space-y-6">

          {/* Upload */}
          {(appState === 'idle' || appState === 'error') && (
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Vídeo
              </h2>
              <UploadArea
                onJobStart={handleJobStart}
                onFileSelected={handleFileSelected}
                options={{ detection, format }}
                disabled={isProcessing}
              />
              {appState === 'error' && errorMsg && (
                <div className="mt-3 p-3 bg-red-950/40 border border-red-800 rounded-lg">
                  <p className="text-sm text-red-400">{errorMsg}</p>
                  <button
                    onClick={handleReset}
                    className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Detectando silêncios */}
          {appState === 'detecting' && jobId && (
            <section className="space-y-5">
              {/* Preview do vídeo já aparece durante a detecção */}
              {originalVideoBlobUrl && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Preview
                  </h2>
                  <VideoPreview blobUrl={originalVideoBlobUrl} />
                </div>
              )}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                  Analisando vídeo
                </h2>
                <ProcessingProgress
                  jobId={jobId}
                  onDetected={handleDetected}
                  onDone={handleCutDone}
                  onError={handleError}
                />
              </div>
            </section>
          )}

          {/* Timeline ao vivo — editar antes de cortar / progresso durante corte */}
          {(appState === 'detected' || appState === 'cutting') && detectionResult && (
            <section className="space-y-5">
              {/* Preview do vídeo original */}
              <div>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Preview
                </h2>
                <VideoPreview
                  blobUrl={originalVideoBlobUrl}
                  silences={appState === 'detected' ? computedSilences : undefined}
                />
              </div>

              {noSilencesWarning && appState === 'detected' && (
                <div className="p-3 bg-yellow-950/40 border border-yellow-800 rounded-lg">
                  <p className="text-sm text-yellow-300">
                    Nenhum silêncio detectado com os parâmetros atuais. Ajuste o Threshold ou a Duração Mínima.
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                    Timeline
                  </h2>
                  {hasManualOverrides && appState === 'detected' && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-amber-400">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        Editado manualmente
                      </span>
                      <button
                        onClick={handleResetOverrides}
                        className="text-xs text-gray-500 hover:text-gray-300 underline transition-colors"
                      >
                        Resetar para automático
                      </button>
                    </div>
                  )}
                </div>
                <div className={isRedetecting ? 'opacity-50 transition-opacity duration-200' : 'transition-opacity duration-200'}>
                  <CutTimeline
                    silences={computedSilences}
                    totalDuration={detectionResult.totalDuration}
                    audioFile={audioFile}
                    onSilencesChange={appState === 'detected' ? handleTimelineEdit : undefined}
                  />
                </div>

                {/* Progress bar inline durante o corte */}
                {appState === 'cutting' && jobId && (
                  <div className="mt-3 bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <ProcessingProgress
                      jobId={jobId}
                      onDetected={handleDetected}
                      onDone={handleCutDone}
                      onError={handleError}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between flex-wrap gap-3">
                <FormatSelector value={format} onChange={setFormat} disabled={appState === 'cutting'} />
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleReset}
                    disabled={appState === 'cutting'}
                    className="text-sm text-gray-500 hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Novo vídeo
                  </button>

                  {appState === 'cutting' ? (
                    <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 text-gray-400 text-sm font-semibold rounded-lg">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Cortando...
                    </div>
                  ) : (
                    <button
                      onClick={handleCut}
                      disabled={isRedetecting || isStartingCut}
                      className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      {isStartingCut ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                        </svg>
                      )}
                      {isStartingCut ? 'Iniciando...' : 'Cortar vídeo'}
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Resultado final */}
          {appState === 'done' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Preview
                </h2>
                <VideoPreview blobUrl={cutVideoBlobUrl} />
              </div>

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div />
                <div className="flex items-center gap-3">
                  {cutVideoBlobUrl && (
                    <DownloadButton
                      blobUrl={cutVideoBlobUrl}
                      format={formatAtCut.current}
                    />
                  )}
                  <button
                    onClick={handleReset}
                    className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Novo vídeo
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Sidebar: Configurações */}
        <aside>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Detecção
          </h2>
          <DetectionSettings
            value={detection}
            onChange={setDetection}
            disabled={isProcessing}
          />

          {(appState === 'idle' || appState === 'detected') && (
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Formato de Saída
              </h2>
              <FormatSelector value={format} onChange={setFormat} />
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
