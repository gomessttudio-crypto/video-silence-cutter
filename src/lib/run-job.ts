import { updateJob } from './job-store'
import { detectSilences } from './silence-detection'
import type { DetectionOptions } from './types'

const MAX_DURATION = parseInt(process.env.MAX_DURATION_SECONDS ?? '600')

export async function runJob(
  jobId: string,
  inputPath: string,
  options: DetectionOptions,
): Promise<void> {
  try {
    updateJob(jobId, { status: 'detecting', progress: 5 })

    const { silences, rawSilences, totalDuration } = await detectSilences(inputPath, options)

    if (totalDuration > MAX_DURATION) {
      updateJob(jobId, {
        status: 'error',
        error: `Vídeo muito longo. Máximo: ${MAX_DURATION / 60} minutos.`,
      })
      return
    }

    updateJob(jobId, {
      status: 'detected',
      progress: 100,
      silences,
      rawSilences,
      totalDuration,
    })
  } catch (err) {
    console.error('[runJob] erro:', err)
    updateJob(jobId, { status: 'error', error: String(err) })
  }
}
