'use client'

import type { OutputFormat } from '@/lib/types'

interface DownloadButtonProps {
  blobUrl: string
  format: OutputFormat
  disabled?: boolean
}

export default function DownloadButton({ blobUrl, format, disabled }: DownloadButtonProps) {
  function handleDownload() {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `output.${format}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <button
      onClick={handleDownload}
      disabled={disabled}
      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700
        text-white font-semibold px-6 py-2.5 rounded-lg transition-colors
        disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Download {format.toUpperCase()}
    </button>
  )
}
