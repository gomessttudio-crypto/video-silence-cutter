import { NextRequest, NextResponse } from 'next/server'
import Busboy from 'busboy'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { createJob, getJob, updateJob } from '@/lib/job-store'
import { runJob } from '@/lib/run-job'
import type { DetectionOptions, OutputFormat } from '@/lib/types'

export const runtime = 'nodejs'

const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Content-Type inválido' }, { status: 400 })
  }

  return new Promise<NextResponse>((resolve) => {
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => { headers[k] = v })

    const busboy = Busboy({ headers })

    let jobId = ''
    let chunkIndex = 0
    let totalChunks = 1
    let mimeType = ''
    let detectionOptions: DetectionOptions = {
      threshold: 0.0156,
      minDuration: 0.5,
      paddingLeft: 0.0667,
      paddingRight: 0.0667,
      removeShortSpikes: 0,
    }
    let outputFormat: OutputFormat = 'mp4'
    let fileError: string | null = null
    let resolvedInputPath = ''

    busboy.on('field', (name, value) => {
      switch (name) {
        case 'jobId':             jobId = value; break
        case 'chunkIndex':        chunkIndex = parseInt(value) || 0; break
        case 'totalChunks':       totalChunks = parseInt(value) || 1; break
        case 'mimeType':          mimeType = value; break
        case 'threshold':         detectionOptions.threshold = parseFloat(value) || detectionOptions.threshold; break
        case 'minDuration':       detectionOptions.minDuration = parseFloat(value) || detectionOptions.minDuration; break
        case 'paddingLeft':       detectionOptions.paddingLeft = parseFloat(value) ?? detectionOptions.paddingLeft; break
        case 'paddingRight':      detectionOptions.paddingRight = parseFloat(value) ?? detectionOptions.paddingRight; break
        case 'removeShortSpikes': detectionOptions.removeShortSpikes = parseFloat(value) || 0; break
        case 'format':            outputFormat = (value === 'mov' ? 'mov' : 'mp4'); break
      }
    })

    busboy.on('file', (_field, stream, _info) => {
      if (chunkIndex === 0) {
        if (!ALLOWED_TYPES.includes(mimeType)) {
          fileError = 'Formato não suportado. Use MP4, MOV ou WebM.'
          stream.resume()
          return
        }
        const tempId = uuidv4()
        resolvedInputPath = path.join(os.tmpdir(), `vsc-${tempId}-input.tmp`)
        const ws = fs.createWriteStream(resolvedInputPath)
        ws.on('error', (err) => { fileError = String(err) })
        stream.pipe(ws)
      } else {
        const job = getJob(jobId)
        if (!job) {
          fileError = 'Job não encontrado. Tente novamente.'
          stream.resume()
          return
        }
        resolvedInputPath = job.inputPath
        const ws = fs.createWriteStream(resolvedInputPath, { flags: 'a' })
        ws.on('error', (err) => { fileError = String(err) })
        stream.pipe(ws)
      }
    })

    busboy.on('finish', () => {
      if (fileError) {
        return resolve(NextResponse.json({ error: fileError }, { status: 400 }))
      }

      const isLast = chunkIndex === totalChunks - 1

      if (chunkIndex === 0) {
        const ext = outputFormat === 'mov' ? 'mov' : 'mp4'
        const outputPath = resolvedInputPath.replace('-input.tmp', `-output.${ext}`)
        const job = createJob(resolvedInputPath, outputPath, outputFormat)
        jobId = job.id

        if (isLast) {
          runJob(job.id, resolvedInputPath, detectionOptions).catch((err) => {
            updateJob(job.id, { status: 'error', error: String(err) })
          })
          return resolve(NextResponse.json({ jobId: job.id, done: true }))
        }

        return resolve(NextResponse.json({ jobId: job.id }))
      }

      if (isLast) {
        runJob(jobId, resolvedInputPath, detectionOptions).catch((err) => {
          updateJob(jobId, { status: 'error', error: String(err) })
        })
        return resolve(NextResponse.json({ jobId, done: true }))
      }

      resolve(NextResponse.json({ jobId }))
    })

    busboy.on('error', (err: Error) => {
      resolve(NextResponse.json({ error: String(err) }, { status: 500 }))
    })

    req.body?.pipeTo(
      new WritableStream({
        write(chunk) { busboy.write(chunk) },
        close() { busboy.end() },
        abort(err) { busboy.destroy(err) },
      })
    )
  })
}
