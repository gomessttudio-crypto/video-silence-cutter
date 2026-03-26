import { NextRequest } from 'next/server'
import { getJob } from '@/lib/job-store'
import type { ProgressEvent } from '@/lib/types'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<Response> {
  const jobId = req.nextUrl.searchParams.get('id')

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'id obrigatório' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const job = getJob(jobId)
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job não encontrado' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  let intervalId: ReturnType<typeof setInterval>

  const stream = new ReadableStream({
    start(controller) {
      function sendEvent(data: ProgressEvent) {
        const payload = `data: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(payload))
      }

      intervalId = setInterval(() => {
        const currentJob = getJob(jobId)

        if (!currentJob) {
          sendEvent({ progress: 0, status: 'error', error: 'Job não encontrado' })
          clearInterval(intervalId)
          controller.close()
          return
        }

        const event: ProgressEvent = {
          progress: currentJob.progress,
          status: currentJob.status,
        }

        if (currentJob.status === 'detected') {
          event.totalDuration = currentJob.totalDuration
          event.silences = currentJob.silences
          event.rawSilences = currentJob.rawSilences
        }

        if (currentJob.status === 'error') {
          event.error = currentJob.error
        }

        sendEvent(event)

        if (currentJob.status === 'detected' || currentJob.status === 'done' || currentJob.status === 'error') {
          clearInterval(intervalId)
          // Delay para garantir que a mensagem seja recebida antes do fechamento
          setTimeout(() => {
            try { controller.close() } catch {}
          }, 1000)
        }
      }, 500)
    },
    cancel() {
      clearInterval(intervalId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
