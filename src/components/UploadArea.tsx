'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import type { FileRejection } from 'react-dropzone'
import type { ProcessOptions } from '@/lib/types'

interface UploadAreaProps {
  onJobStart: (jobId: string) => void
  onFileSelected?: (blobUrl: string, file: File) => void
  options: ProcessOptions
  disabled?: boolean
}

const MAX_SIZE = 2048 * 1024 * 1024 // 2GB
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export default function UploadArea({ onJobStart, onFileSelected, options, disabled }: UploadAreaProps) {
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const uploadFile = useCallback((file: File) => {
    setError(null)
    setUploadProgress(0)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('threshold', String(options.detection.threshold))
    formData.append('minDuration', String(options.detection.minDuration))
    formData.append('paddingLeft', String(options.detection.paddingLeft))
    formData.append('paddingRight', String(options.detection.paddingRight))
    formData.append('removeShortSpikes', String(options.detection.removeShortSpikes))
    formData.append('format', options.format)

    const xhr = new XMLHttpRequest()

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const json = JSON.parse(xhr.responseText)
          setUploadProgress(null)
          onJobStart(json.jobId)
        } catch {
          setError('Resposta inválida do servidor.')
          setUploadProgress(null)
        }
      } else {
        try {
          const json = JSON.parse(xhr.responseText)
          setError(json.error ?? 'Erro ao enviar arquivo.')
        } catch {
          setError('Erro ao enviar arquivo.')
        }
        setUploadProgress(null)
      }
    }

    xhr.onerror = () => {
      setError('Erro de conexão. Verifique sua internet.')
      setUploadProgress(null)
    }

    xhr.open('POST', '/api/process')
    xhr.send(formData)
  }, [options, onJobStart])

  const onDrop = useCallback((accepted: File[], rejected: FileRejection[]) => {
    if (rejected.length > 0) {
      const err = rejected[0].errors[0]
      if (err.code === 'file-too-large') {
        setError('Arquivo muito grande. Máximo: 2GB.')
      } else if (err.code === 'file-invalid-type') {
        setError('Formato não suportado. Use MP4, MOV ou WebM.')
      } else {
        setError('Arquivo inválido.')
      }
      return
    }
    if (accepted.length > 0) {
      if (onFileSelected) onFileSelected(URL.createObjectURL(accepted[0]), accepted[0])
      uploadFile(accepted[0])
    }
  }, [uploadFile])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/mp4': ['.mp4'],
      'video/quicktime': ['.mov'],
      'video/webm': ['.webm'],
    },
    maxSize: MAX_SIZE,
    multiple: false,
    disabled: disabled || uploadProgress !== null,
  })

  const isUploading = uploadProgress !== null

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`
          relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive
            ? 'border-blue-400 bg-blue-950/30'
            : 'border-gray-700 bg-gray-900 hover:border-gray-500 hover:bg-gray-800/50'
          }
          ${(disabled || isUploading) ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center gap-3 pointer-events-none">
          <svg className="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>

          {isDragActive ? (
            <p className="text-blue-400 font-medium">Solte o vídeo aqui</p>
          ) : (
            <>
              <p className="text-gray-300 font-medium">
                Arraste seu vídeo ou <span className="text-blue-400">clique para selecionar</span>
              </p>
              <p className="text-xs text-gray-500">MP4, MOV ou WebM · até 2GB · máx. 10 minutos</p>
            </>
          )}
        </div>
      </div>

      {/* Progresso de upload */}
      {isUploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Enviando...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Erro */}
      {error && (
        <p className="text-sm text-red-400 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  )
}
