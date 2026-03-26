'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { SilenceSegment } from '@/lib/types'

interface CutTimelineProps {
  silences: SilenceSegment[]
  totalDuration: number
  audioFile?: File | null
  onSilencesChange?: (newSilences: SilenceSegment[]) => void
}

const CANVAS_HEIGHT = 64
const MINIMAP_HEIGHT = 12
const ZOOM_LEVELS = [1, 2, 4, 8, 16]

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function isInSilence(time: number, silences: SilenceSegment[]): SilenceSegment | null {
  return silences.find(s => time >= s.start && time <= s.end) ?? null
}

function downsample(channel: Float32Array, targetLength: number): Float32Array {
  const result = new Float32Array(targetLength)
  const blockSize = Math.floor(channel.length / targetLength)
  for (let i = 0; i < targetLength; i++) {
    let max = 0
    const start = i * blockSize
    for (let j = 0; j < blockSize; j++) {
      const abs = Math.abs(channel[start + j] ?? 0)
      if (abs > max) max = abs
    }
    result[i] = max
  }
  return result
}

export default function CutTimeline({ silences, totalDuration, audioFile, onSilencesChange }: CutTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; time: string } | null>(null)
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null)
  const [isDecodingAudio, setIsDecodingAudio] = useState(false)

  // Zoom state
  const [zoom, setZoom] = useState(1)
  const [viewStart, setViewStart] = useState(0)

  // Drag state for manual override
  const dragRef = useRef<{ startTime: number; currentTime: number; mode: 'add' | 'remove' } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ startTime: number; currentTime: number; mode: 'add' | 'remove' } | null>(null)

  // Minimap drag
  const minimapDragging = useRef(false)

  const clampViewStart = useCallback((start: number, zoomLevel: number) => {
    if (totalDuration <= 0) return 0
    const viewDur = totalDuration / zoomLevel
    return Math.max(0, Math.min(start, totalDuration - viewDur))
  }, [totalDuration])

  const viewDuration = totalDuration > 0 ? totalDuration / zoom : 0

  // Decode audio waveform
  useEffect(() => {
    if (!audioFile) { setWaveformData(null); return }
    let cancelled = false
    setIsDecodingAudio(true)
    audioFile.arrayBuffer().then(buffer => {
      const ctx = new AudioContext()
      return ctx.decodeAudioData(buffer)
    }).then(audioBuffer => {
      if (cancelled) return
      const channel = audioBuffer.getChannelData(0)
      // Store full high-res waveform (4x container width for zoom detail)
      const width = containerRef.current?.clientWidth ?? 800
      setWaveformData(downsample(channel, width * 4))
    }).catch(() => {
      // silently fail — fallback to solid colors
    }).finally(() => {
      if (!cancelled) setIsDecodingAudio(false)
    })
    return () => { cancelled = true }
  }, [audioFile])

  // Reset zoom/viewStart when duration changes (new file)
  useEffect(() => {
    setZoom(1)
    setViewStart(0)
  }, [totalDuration])

  // Draw main canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || totalDuration <= 0) return

    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = CANVAS_HEIGHT

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const vDur = totalDuration / zoom
    const vStart = viewStart

    // Background
    ctx.fillStyle = '#111827'
    ctx.fillRect(0, 0, width, height)

    const centerY = height / 2

    if (waveformData && waveformData.length > 0) {
      for (let x = 0; x < width; x++) {
        const timeAtX = vStart + (x / width) * vDur
        // Map timeAtX to waveformData index using full duration ratio
        const ratio = timeAtX / totalDuration
        const sampleIdx = Math.floor(ratio * waveformData.length)
        const amplitude = waveformData[Math.min(sampleIdx, waveformData.length - 1)] ?? 0

        const inSilence = isInSilence(timeAtX, silences)

        let inDragPreview = false
        let dragPreviewIsAdd = false
        if (dragPreview) {
          const t1 = Math.min(dragPreview.startTime, dragPreview.currentTime)
          const t2 = Math.max(dragPreview.startTime, dragPreview.currentTime)
          if (timeAtX >= t1 && timeAtX <= t2) {
            inDragPreview = true
            dragPreviewIsAdd = dragPreview.mode === 'add'
          }
        }

        let color: string
        if (inDragPreview) {
          color = dragPreviewIsAdd ? 'rgba(239, 68, 68, 0.7)' : 'rgba(59, 130, 246, 0.7)'
        } else if (inSilence) {
          color = '#f87171'
        } else {
          color = '#60a5fa'
        }

        const barHeight = Math.max(1, amplitude * (height * 0.85))
        ctx.fillStyle = color
        ctx.fillRect(x, centerY - barHeight / 2, 1, barHeight)
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, centerY)
      ctx.lineTo(width, centerY)
      ctx.stroke()
    } else {
      // Fallback: solid color blocks
      ctx.fillStyle = '#3b82f6'
      ctx.fillRect(0, 0, width, height)

      for (const s of silences) {
        const xStart = ((s.start - vStart) / vDur) * width
        const xEnd = ((s.end - vStart) / vDur) * width
        if (xEnd < 0 || xStart > width) continue
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(Math.max(xStart, 0), 0, Math.min(xEnd, width) - Math.max(xStart, 0), height)
      }

      if (dragPreview) {
        const t1 = Math.min(dragPreview.startTime, dragPreview.currentTime)
        const t2 = Math.max(dragPreview.startTime, dragPreview.currentTime)
        const x1 = ((t1 - vStart) / vDur) * width
        const x2 = ((t2 - vStart) / vDur) * width
        ctx.fillStyle = dragPreview.mode === 'add' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(59, 130, 246, 0.5)'
        ctx.fillRect(x1, 0, x2 - x1, height)
      }
    }

    ctx.strokeStyle = '#1f2937'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, width, height)
  }, [silences, totalDuration, waveformData, dragPreview, zoom, viewStart])

  // Draw minimap
  const drawMinimap = useCallback(() => {
    const canvas = minimapRef.current
    const container = containerRef.current
    if (!canvas || !container || totalDuration <= 0 || zoom <= 1) return

    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = MINIMAP_HEIGHT

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    // Background
    ctx.fillStyle = '#1f2937'
    ctx.fillRect(0, 0, width, height)

    // Draw full waveform or silence blocks in minimap
    if (waveformData && waveformData.length > 0) {
      for (let x = 0; x < width; x++) {
        const timeAtX = (x / width) * totalDuration
        const sampleIdx = Math.floor((x / width) * waveformData.length)
        const amplitude = waveformData[Math.min(sampleIdx, waveformData.length - 1)] ?? 0
        const inSilence = isInSilence(timeAtX, silences)
        ctx.fillStyle = inSilence ? '#f87171' : '#60a5fa'
        const barH = Math.max(1, amplitude * (height * 0.9))
        ctx.fillRect(x, height - barH, 1, barH)
      }
    } else {
      ctx.fillStyle = '#3b82f6'
      ctx.fillRect(0, 0, width, height)
      for (const s of silences) {
        const x = (s.start / totalDuration) * width
        const w = ((s.end - s.start) / totalDuration) * width
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(x, 0, Math.max(w, 1), height)
      }
    }

    // Viewport overlay
    const vpX = (viewStart / totalDuration) * width
    const vpW = (viewDuration / totalDuration) * width
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(vpX, 0, vpW, height)
    // Viewport border
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1
    ctx.strokeRect(vpX, 0, vpW, height)
  }, [silences, totalDuration, waveformData, zoom, viewStart, viewDuration])

  useEffect(() => { draw() }, [draw])
  useEffect(() => { drawMinimap() }, [drawMinimap])

  // Handle window resize
  useEffect(() => {
    const observer = new ResizeObserver(() => { draw(); drawMinimap() })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [draw, drawMinimap])

  function getTimeAtX(e: React.MouseEvent<HTMLCanvasElement>): number {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = viewStart + (x / rect.width) * viewDuration
    return Math.max(0, Math.min(time, totalDuration))
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const timeAtCursor = viewStart + (x / rect.width) * viewDuration

    const currentIdx = ZOOM_LEVELS.indexOf(zoom)
    let newZoom = zoom
    if (e.deltaY < 0 && currentIdx < ZOOM_LEVELS.length - 1) {
      newZoom = ZOOM_LEVELS[currentIdx + 1]
    } else if (e.deltaY > 0 && currentIdx > 0) {
      newZoom = ZOOM_LEVELS[currentIdx - 1]
    }
    if (newZoom === zoom) return

    const newViewDur = totalDuration / newZoom
    // Keep time under cursor stationary
    const newViewStart = timeAtCursor - (x / rect.width) * newViewDur
    setZoom(newZoom)
    setViewStart(clampViewStart(newViewStart, newZoom))
  }

  function handleZoomIn() {
    const idx = ZOOM_LEVELS.indexOf(zoom)
    if (idx < ZOOM_LEVELS.length - 1) {
      const newZoom = ZOOM_LEVELS[idx + 1]
      const newViewDur = totalDuration / newZoom
      const center = viewStart + viewDuration / 2
      setZoom(newZoom)
      setViewStart(clampViewStart(center - newViewDur / 2, newZoom))
    }
  }

  function handleZoomOut() {
    const idx = ZOOM_LEVELS.indexOf(zoom)
    if (idx > 0) {
      const newZoom = ZOOM_LEVELS[idx - 1]
      const newViewDur = totalDuration / newZoom
      const center = viewStart + viewDuration / 2
      setZoom(newZoom)
      setViewStart(clampViewStart(center - newViewDur / 2, newZoom))
    }
  }

  // Minimap mouse handlers
  function getMinimapTime(e: React.MouseEvent<HTMLCanvasElement>): number {
    const rect = minimapRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    return Math.max(0, Math.min((x / rect.width) * totalDuration, totalDuration))
  }

  function handleMinimapMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    minimapDragging.current = true
    const time = getMinimapTime(e)
    setViewStart(clampViewStart(time - viewDuration / 2, zoom))
  }

  function handleMinimapMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!minimapDragging.current) return
    const time = getMinimapTime(e)
    setViewStart(clampViewStart(time - viewDuration / 2, zoom))
  }

  function handleMinimapMouseUp() {
    minimapDragging.current = false
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onSilencesChange) return
    const time = getTimeAtX(e)
    const inSilence = isInSilence(time, silences)
    const mode: 'add' | 'remove' = inSilence ? 'remove' : 'add'
    dragRef.current = { startTime: time, currentTime: time, mode }
    setDragPreview({ startTime: time, currentTime: time, mode })
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas || totalDuration <= 0) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = viewStart + (x / rect.width) * viewDuration
    setTooltip({ x, time: formatTime(Math.max(0, Math.min(time, totalDuration))) })

    if (dragRef.current) {
      const clampedTime = Math.max(0, Math.min(time, totalDuration))
      dragRef.current.currentTime = clampedTime
      setDragPreview({ ...dragRef.current, currentTime: clampedTime })
    }
  }

  function handleMouseUp() {
    if (!onSilencesChange || !dragRef.current) return
    const drag = dragRef.current
    dragRef.current = null
    setDragPreview(null)

    const t1 = Math.min(drag.startTime, drag.currentTime)
    const t2 = Math.max(drag.startTime, drag.currentTime)
    const delta = t2 - t1

    if (drag.mode === 'remove') {
      const newSilences = silences.filter(s => {
        if (delta < 0.05) return !(drag.startTime >= s.start && drag.startTime <= s.end)
        return s.end <= t1 || s.start >= t2
      })
      onSilencesChange(newSilences)
    } else {
      if (delta < 0.05) return
      const merged: SilenceSegment[] = []
      let newStart = t1
      let newEnd = t2
      for (const s of silences) {
        if (s.end < newStart || s.start > newEnd) {
          merged.push(s)
        } else {
          newStart = Math.min(newStart, s.start)
          newEnd = Math.max(newEnd, s.end)
        }
      }
      merged.push({ start: newStart, end: newEnd })
      merged.sort((a, b) => a.start - b.start)
      onSilencesChange(merged)
    }
  }

  function handleMouseLeave() {
    setTooltip(null)
    if (dragRef.current) {
      dragRef.current = null
      setDragPreview(null)
    }
  }

  const keptSeconds = totalDuration - silences.reduce((acc, s) => acc + (s.end - s.start), 0)
  const pctKept = totalDuration > 0 ? Math.round((keptSeconds / totalDuration) * 100) : 100

  const canZoomIn = ZOOM_LEVELS.indexOf(zoom) < ZOOM_LEVELS.length - 1
  const canZoomOut = zoom > 1

  // Visible time range labels
  const visibleEnd = Math.min(viewStart + viewDuration, totalDuration)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{formatTime(viewStart)}</span>
        <span className="flex items-center gap-2 text-gray-400">
          {isDecodingAudio && (
            <svg className="w-3 h-3 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          {silences.length} silêncio{silences.length !== 1 ? 's' : ''} removido{silences.length !== 1 ? 's' : ''} · {pctKept}% mantido
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleZoomOut}
            disabled={!canZoomOut}
            title="Reduzir zoom"
            className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-300"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16zM8 11h6" />
            </svg>
          </button>
          <span className="text-gray-500 font-mono w-7 text-center">{zoom}x</span>
          <button
            onClick={handleZoomIn}
            disabled={!canZoomIn}
            title="Ampliar zoom"
            className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-300"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16zM11 8v6M8 11h6" />
            </svg>
          </button>
          <span className="text-gray-600 ml-1">{formatTime(visibleEnd)}</span>
        </div>
      </div>

      <div ref={containerRef} className="relative w-full rounded overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full"
          style={{ cursor: onSilencesChange ? 'crosshair' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        />
        {tooltip && (
          <div
            className="absolute -top-7 bg-gray-900 text-gray-200 text-xs px-2 py-0.5 rounded shadow pointer-events-none"
            style={{ left: tooltip.x, transform: 'translateX(-50%)' }}
          >
            {tooltip.time}
          </div>
        )}

        {/* Minimap — only when zoomed in */}
        {zoom > 1 && (
          <canvas
            ref={minimapRef}
            className="w-full mt-1 rounded cursor-pointer"
            style={{ height: MINIMAP_HEIGHT }}
            onMouseDown={handleMinimapMouseDown}
            onMouseMove={handleMinimapMouseMove}
            onMouseUp={handleMinimapMouseUp}
            onMouseLeave={handleMinimapMouseUp}
          />
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-blue-400" /> Áudio mantido
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-400" /> Silêncio removido
        </span>
        {onSilencesChange && (
          <span className="text-gray-600">· Clique p/ remover · Arraste p/ marcar · Scroll p/ zoom</span>
        )}
      </div>
    </div>
  )
}
