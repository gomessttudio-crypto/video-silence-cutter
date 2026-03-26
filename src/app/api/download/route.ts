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

  const fileBuffer = fs.readFileSync(job.outputPath)

  // Cleanup após leitura
  try { fs.unlinkSync(job.inputPath) } catch {}
  try { fs.unlinkSync(job.outputPath) } catch {}
  deleteJob(jobId)

  return new Response(fileBuffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(fileBuffer.length),
    },
  })
}
