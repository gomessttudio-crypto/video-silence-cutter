import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { getJob, updateJob } from '@/lib/job-store'
import { invertSegments, applyJumpCuts } from '@/lib/ffmpeg'
import type { SilenceSegment } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { jobId?: string; silences?: SilenceSegment[] }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { jobId, silences } = body

  if (!jobId || !Array.isArray(silences)) {
    return NextResponse.json({ error: 'jobId e silences são obrigatórios' }, { status: 400 })
  }

  const job = getJob(jobId)
  if (!job) {
    return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 })
  }
  if (job.status !== 'detected') {
    return NextResponse.json({ error: 'Job não está na etapa de detecção concluída' }, { status: 400 })
  }

  // Inicia corte em background
  updateJob(jobId, { status: 'cutting', progress: 0 })

  runCut(jobId, silences).catch((err) => {
    updateJob(jobId, { status: 'error', error: String(err) })
  })

  return NextResponse.json({ jobId })
}

async function runCut(jobId: string, silences: SilenceSegment[]): Promise<void> {
  const job = getJob(jobId)
  if (!job) return

  try {
    const segments = invertSegments(silences, job.totalDuration)
    updateJob(jobId, { segments })

    await applyJumpCuts(job.inputPath, segments, job.outputPath, job.format, (percent) => {
      const mapped = Math.round(percent * 0.95)
      updateJob(jobId, { progress: Math.min(mapped, 95) })
    })

    // Libera o input imediatamente — não é mais necessário após o corte
    try { fs.unlinkSync(job.inputPath) } catch {}

    updateJob(jobId, { status: 'done', progress: 100, silences })
  } catch (err) {
    console.error('[runCut] erro:', err)
    updateJob(jobId, { status: 'error', error: String(err) })
  }
}
