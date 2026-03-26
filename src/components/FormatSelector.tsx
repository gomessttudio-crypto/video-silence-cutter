'use client'

import type { OutputFormat } from '@/lib/types'

interface FormatSelectorProps {
  value: OutputFormat
  onChange: (format: OutputFormat) => void
  disabled?: boolean
}

export default function FormatSelector({ value, onChange, disabled }: FormatSelectorProps) {
  return (
    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
      {(['mp4', 'mov'] as OutputFormat[]).map((fmt) => (
        <button
          key={fmt}
          onClick={() => onChange(fmt)}
          disabled={disabled}
          className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors
            ${value === fmt
              ? 'bg-blue-600 text-white shadow'
              : 'text-gray-400 hover:text-gray-200'
            }
            disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {fmt.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
