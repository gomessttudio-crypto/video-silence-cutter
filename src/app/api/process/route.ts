import { NextRequest, NextResponse } from 'next/server'
import Busboy from 'busboy'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { createJob, updateJob } from '@/lib/job-store'
import { runJob } from '@/lib/run-job'
import type { DetectionOptions, OutputFormat } from '@/lib/types'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB ?? '2048') * 1024 * 1024
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Content-Type inválido' }, { status: 400 })
  }

  const id = uuidv4()
  const inputPath = path.join(os.tmpdir(), `vsc-${id}-input.tmp`)

  return new Promise<NextResponse>((resolve) => {
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => { headers[k] = v })

    const busboy = Busboy({ headers })

    let detectionOptions: DetectionOptions = {
      threshold: 0.0156,
      minDuration: 0.5,
      paddingLeft: 0.0667,
      paddingRight: 0.0667,
      removeShortSpikes: 0,
    }
    let outputFormat: OutputFormat = 'mp4'
    let fileReceived = false
    let fileError: string | null = null
    let fileMime = ''

    busboy.on('field', (name, value) => {
      switch (name) {
        case 'threshold':       detectionOptions.threshold = parseFloat(value) || detectionOptions.threshold; break
        case 'minDuration':     detectionOptions.minDuration = parseFloat(value) || detectionOptions.minDuration; break
        case 'paddingLeft':     detectionOptions.paddingLeft = parseFloat(value) ?? detectionOptions.paddingLeft; break
        case 'paddingRight':    detectionOptions.paddingRight = parseFloat(value) ?? detectionOptions.paddingRight; break
        case 'removeShortSpikes': detectionOptions.removeShortSpikes = parseFloat(value) || 0; break
        case 'format':          outputFormat = (value === 'mov' ? 'mov' : 'mp4'); break
      }
    })

    busboy.on('file', (_field, stream, info) => {
      fileMime = info.mimeType

      if (!ALLOWED_TYPES.includes(fileMime)) {
        fileError = 'Formato não suportado. Use MP4, MOV ou WebM.'
        stream.resume()
        return
      }

      fileReceived = true
      let bytesReceived = 0
      const writeStream = fs.createWriteStream(inputPath)

      stream.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length
        if (bytesReceived > MAX_FILE_SIZE) {
          fileError = `Arquivo muito grande. Máximo: ${process.env.MAX_FILE_SIZE_MB ?? '2048'}MB.`
          stream.destroy()
          writeStream.destroy()
          try { fs.unlinkSync(inputPath) } catch {}
        }
      })

      stream.pipe(writeStream)
    })

    busboy.on('finish', () => {
      if (fileError) {
        return resolve(NextResponse.json({ error: fileError }, { status: 400 }))
      }
      if (!fileReceived) {
        return resolve(NextResponse.json({ error: 'Nenhum arquivo recebido' }, { status: 400 }))
      }

      // Determina extensão de saída
      const ext = outputFormat === 'mov' ? 'mov' : 'mp4'
      const outputPath = path.join(os.tmpdir(), `vsc-${id}-output.${ext}`)

      const job = createJob(inputPath, outputPath, outputFormat)

      // Inicia processamento em background (sem await)
      runJob(job.id, inputPath, detectionOptions).catch((err) => {
        updateJob(job.id, { status: 'error', error: String(err) })
      })

      resolve(NextResponse.json({ jobId: job.id }))
    })

    busboy.on('error', (err: Error) => {
      resolve(NextResponse.json({ error: String(err) }, { status: 500 }))
    })

    // Alimenta o busboy com o body da request
    req.body?.pipeTo(
      new WritableStream({
        write(chunk) { busboy.write(chunk) },
        close() { busboy.end() },
        abort(err) { busboy.destroy(err) },
      })
    )
  })
}

