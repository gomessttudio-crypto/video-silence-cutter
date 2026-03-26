import ffmpegStatic from 'ffmpeg-static'
import { spawn } from 'child_process'
import type { DetectionOptions, SilenceSegment } from './types'
import { mergeSilences, applyPadding } from './silence-utils'

export { mergeSilences, applyPadding }

/**
 * Detecta silêncios brutos no arquivo de entrada via FFmpeg silencedetect.
 * Retorna os intervalos RAW (sem padding aplicado).
 */
export async function detectSilencesRaw(
  inputPath: string,
  threshold: number,
  minDuration: number
): Promise<{ silences: SilenceSegment[]; totalDuration: number }> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = ffmpegStatic as string
    console.log('[ffmpeg] binary path:', ffmpegPath)
    const args = [
      '-hide_banner',
      '-vn',
      '-i', inputPath,
      '-af', `silencedetect=n=${threshold}:d=${minDuration}`,
      '-f', 'null',
      '-',
    ]

    const proc = spawn(ffmpegPath, args)
    let stderr = ''

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        // FFmpeg exits non-zero for -f null, which is normal — check if we got useful output
        if (!stderr.includes('silencedetect') && !stderr.includes('Duration')) {
          return reject(new Error(`FFmpeg silencedetect falhou (code ${code})`))
        }
      }

      const silences: SilenceSegment[] = []
      const startMatches = Array.from(stderr.matchAll(/silence_start: ([\d.]+)/g))
      const endMatches = Array.from(stderr.matchAll(/silence_end: ([\d.]+)/g))

      for (let i = 0; i < startMatches.length; i++) {
        const start = parseFloat(startMatches[i][1])
        const end = endMatches[i] ? parseFloat(endMatches[i][1]) : -1

        if (end > start) {
          silences.push({ start, end })
        }
      }

      // Duração total via regex no stderr
      const durationMatch = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/)
      let totalDuration = 0
      if (durationMatch) {
        const h = parseInt(durationMatch[1])
        const m = parseInt(durationMatch[2])
        const s = parseFloat(durationMatch[3])
        totalDuration = h * 3600 + m * 60 + s
      }

      resolve({ silences, totalDuration })
    })

    proc.on('error', (err) => {
      console.error('[ffmpeg] spawn error:', err)
      reject(err)
    })
  })
}

/**
 * Pipeline completo: detecta → mescla blips → aplica padding.
 * Retorna também rawSilences (antes de merge/padding) para recalculo client-side.
 */
export async function detectSilences(
  inputPath: string,
  options: DetectionOptions
): Promise<{ silences: SilenceSegment[]; rawSilences: SilenceSegment[]; totalDuration: number }> {
  const { silences: raw, totalDuration } = await detectSilencesRaw(
    inputPath,
    options.threshold,
    options.minDuration
  )

  const merged = mergeSilences(raw, options.removeShortSpikes)
  const withPadding = applyPadding(merged, options.paddingLeft, options.paddingRight)

  return { silences: withPadding, rawSilences: raw, totalDuration }
}
