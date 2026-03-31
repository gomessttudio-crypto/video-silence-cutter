import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { Job, OutputFormat } from './types'

// Singleton global — compartilhado entre todos os bundles do Next.js no mesmo processo
declare global {
  var __vscJobStore: Map<string, Job> | undefined
  var __vscCleanupStarted: boolean | undefined
}

if (!globalThis.__vscJobStore) {
  globalThis.__vscJobStore = new Map<string, Job>()
}

const jobs = globalThis.__vscJobStore

export function createJob(inputPath: string, outputPath: string, format: OutputFormat): Job {
  const id = uuidv4()
  const job: Job = {
    id,
    status: 'uploading',
    progress: 0,
    inputPath,
    outputPath,
    format,
    totalDuration: 0,
    silences: [],
    rawSilences: [],
    segments: [],
    createdAt: Date.now(),
  }
  jobs.set(id, job)
  return job
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id)
}

export function updateJob(id: string, updates: Partial<Job>): void {
  const job = jobs.get(id)
  if (!job) return
  Object.assign(job, updates)
}

export function deleteJob(id: string): void {
  jobs.delete(id)
}

/** Deleta jobs criados há mais de 30min e remove seus arquivos temporários */
export function cleanupOldJobs(): void {
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000
  for (const [id, job] of Array.from(jobs.entries())) {
    if (job.createdAt < thirtyMinAgo) {
      try { fs.unlinkSync(job.inputPath) } catch {}
      try { fs.unlinkSync(job.outputPath) } catch {}
      jobs.delete(id)
    }
  }
}

/** Deleta arquivos vsc-* órfãos em /tmp de crashes anteriores */
function cleanupOrphanedTmpFiles(): void {
  try {
    const tmpDir = os.tmpdir()
    for (const file of fs.readdirSync(tmpDir)) {
      if (file.startsWith('vsc-')) {
        try { fs.unlinkSync(path.join(tmpDir, file)) } catch {}
      }
    }
  } catch {}
}

// Guard para rodar cleanup apenas uma vez mesmo com hot reload
if (!globalThis.__vscCleanupStarted) {
  globalThis.__vscCleanupStarted = true
  cleanupOrphanedTmpFiles()
  cleanupOldJobs()
  setInterval(cleanupOldJobs, 15 * 60 * 1000)
}
