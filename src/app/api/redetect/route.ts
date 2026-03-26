import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { getJob, updateJob } from '@/lib/job-store'
import { detectSilencesRaw } from '@/lib/silence-detection'
import { mergeSilences, applyPadding } from '@/lib/silence-utils'

export const runtime = 'nodejs'

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    jobId?: string
    threshold?: number
    minDuration?: number
    paddingLeft?: number
    paddingRight?: number
    removeShortSpikes?: number
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { jobId, threshold, minDuration, paddingLeft = 0, paddingRight = 0, removeShortSpikes = 0 } = body

  if (!jobId || threshold == null || minDuration == null) {
    return NextResponse.json({ error: 'jobId, threshold e minDuration são obrigatórios' }, { status: 400 })
  }

  const job = getJob(jobId)
  if (!job) {
    return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 })
  }
  if (job.status !== 'done') {
    return NextResponse.json({ error: 'Job ainda não concluído' }, { status: 400 })
  }

  if (!fs.existsSync(job.inputPath)) {
    return NextResponse.json({ error: 'Arquivo de entrada expirou. Faça upload novamente.' }, { status: 410 })
  }

  try {
    const { silences: raw, totalDuration } = await detectSilencesRaw(job.inputPath, threshold, minDuration)
    const merged = mergeSilences(raw, removeShortSpikes)
    const withPadding = applyPadding(merged, paddingLeft, paddingRight)

    updateJob(jobId, { rawSilences: raw, silences: withPadding })

    return NextResponse.json({ rawSilences: raw, silences: withPadding, totalDuration })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
