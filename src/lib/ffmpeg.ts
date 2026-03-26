import ffmpegStatic from 'ffmpeg-static'
import Ffmpeg from 'fluent-ffmpeg'
import type { CutSegment, OutputFormat, SilenceSegment } from './types'

// Aponta o binário do ffmpeg-static
Ffmpeg.setFfmpegPath(ffmpegStatic as string)
console.log('[ffmpeg] setFfmpegPath:', ffmpegStatic)

/**
 * Inverte os segmentos de silêncio para obter os segmentos a MANTER.
 * Ex: silences=[{0,5},{10,15}], duration=20 → keeps=[{5,10},{15,20}]
 */
export function invertSegments(
  silences: SilenceSegment[],
  totalDuration: number
): CutSegment[] {
  if (silences.length === 0) {
    return [{ start: 0, end: totalDuration }]
  }

  const segments: CutSegment[] = []
  let cursor = 0

  for (const silence of silences) {
    if (silence.start > cursor) {
      segments.push({ start: cursor, end: silence.start })
    }
    cursor = silence.end
  }

  if (cursor < totalDuration) {
    segments.push({ start: cursor, end: totalDuration })
  }

  return segments
}

/**
 * Aplica jump cuts no vídeo.
 * Recebe os segmentos a MANTER e gera o arquivo de saída.
 * Emite progresso via callback (0–100).
 */
export async function applyJumpCuts(
  inputPath: string,
  segments: CutSegment[],
  outputPath: string,
  format: OutputFormat,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('[ffmpeg-cut] iniciando', { inputPath, outputPath, segments: segments.length })

    // Timeout de segurança: 10 minutos
    let cutTimeout: ReturnType<typeof setTimeout>

    // Caso especial: sem cortes → copia diretamente
    const isFullVideo =
      segments.length === 1 &&
      segments[0].start === 0

    let cmd = Ffmpeg(inputPath)

    if (isFullVideo) {
      cmd = cmd.outputOptions(['-c', 'copy'])
    } else {
      const selectFilter = segments
        .map((s) => `between(t,${s.start.toFixed(4)},${s.end.toFixed(4)})`)
        .join('+')

      const videoFilter = `select='${selectFilter}',setpts=N/FRAME_RATE/TB`
      const audioFilter = `aselect='${selectFilter}',asetpts=N/SR/TB`

      const outputOpts = [
        '-vf', videoFilter,
        '-af', audioFilter,
        '-c:v', 'libx264',
        '-crf', '22',
        '-preset', 'fast',
        '-c:a', 'aac',
        '-b:a', '128k',
      ]

      if (format === 'mp4') {
        outputOpts.push('-movflags', '+faststart')
      }

      cmd = cmd.outputOptions(outputOpts)
    }

    cutTimeout = setTimeout(() => {
      console.error('[ffmpeg-cut] timeout de 10 minutos — matando processo')
      cmd.kill('SIGKILL')
      reject(new Error('Timeout: o corte demorou mais de 10 minutos'))
    }, 10 * 60 * 1000)

    cmd
      .output(outputPath)
      .on('stderr', (line: string) => console.log('[ffmpeg-cut stderr]', line))
      .on('progress', (info) => {
        if (info.percent != null) {
          onProgress(Math.min(Math.round(info.percent), 99))
        }
      })
      .on('end', () => {
        clearTimeout(cutTimeout)
        console.log('[ffmpeg-cut] concluído')
        onProgress(100)
        resolve()
      })
      .on('error', (err: Error) => {
        clearTimeout(cutTimeout)
        console.error('[ffmpeg-cut] erro:', err)
        reject(err)
      })
      .run()
  })
}
