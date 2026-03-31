import { NextRequest } from 'next/server'
import fs from 'fs'
import { getJob, deleteJob } from '@/lib/job-store'
import type { OutputFormat } from '@/lib/types'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<Response> {
  const jobId = req.nextUrl.searchParams.get('id')
  const format = (req.nextUrl.searchParams.get('format') ?? 'mp4') as OutputFormat

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'id obrigatório' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const job = getJob(jobId)
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job não encontrado. Sessão expirada — faça upload novamente.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (job.status !== 'done') {
    return new Response(JSON.stringify({ error: 'Processamento ainda não concluído' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!fs.existsSync(job.outputPath)) {
    return new Response(JSON.stringify({ error: 'Arquivo não encontrado' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const contentType = format === 'mov' ? 'video/quicktime' : 'video/mp4'
  const filename = `output.${format}`
  const stat = fs.statSync(job.outputPath)

  // Streaming para não carregar o arquivo inteiro em RAM
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return; cleaned = true
    try { fs.unlinkSync(job.outputPath) } catch {}
    deleteJob(jobId)
  }

  const fileStream = fs.createReadStream(job.outputPath)
  const webStream = new ReadableStream({
    start(controller) {
      fileStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)))
      fileStream.on('end', () => { controller.close(); cleanup() })
      fileStream.on('error', (err) => { controller.error(err); cleanup() })
    },
    cancel() { fileStream.destroy(); cleanup() },
  })

  return new Response(webStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(stat.size),
    },
  })
}
