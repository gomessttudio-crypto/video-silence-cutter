export type JobStatus = 'uploading' | 'detecting' | 'detected' | 'cutting' | 'done' | 'error';

export type OutputFormat = 'mp4' | 'mov';

export interface DetectionOptions {
  threshold: number;         // amplitude 0–1, padrão 0.0156 ≈ -36dBFS
  minDuration: number;       // segundos, padrão 0.5
  paddingLeft: number;       // segundos, padrão 0.0667
  paddingRight: number;      // segundos, padrão 0.0667
  removeShortSpikes: number; // segundos, padrão 0 (desabilitado)
}

export interface ProcessOptions {
  detection: DetectionOptions;
  format: OutputFormat;
}

export interface SilenceSegment {
  start: number; // segundos
  end: number;   // segundos
}

export interface CutSegment {
  start: number; // segundos — segmento de ÁUDIO/VÍDEO a MANTER
  end: number;   // segundos
}

export interface Job {
  id: string;             // uuid v4
  status: JobStatus;
  progress: number;       // 0–100
  inputPath: string;      // /tmp/vsc-{id}-input.mp4
  outputPath: string;     // /tmp/vsc-{id}-output.{format}
  format: OutputFormat;
  totalDuration: number;  // duração original em segundos
  silences: SilenceSegment[];     // com merge + padding aplicados
  rawSilences: SilenceSegment[];  // resultado bruto do FFmpeg (sem merge nem padding)
  segments: CutSegment[];
  error?: string;
  createdAt: number;      // Date.now()
}

// Payload enviado via SSE
export interface ProgressEvent {
  progress: number;
  status: JobStatus;
  totalDuration?: number;
  silences?: SilenceSegment[];
  rawSilences?: SilenceSegment[];
  segments?: CutSegment[];
  error?: string;
}

export const DEFAULT_DETECTION: DetectionOptions = {
  threshold: 0.0156,
  minDuration: 0.5,
  paddingLeft: 0.0667,
  paddingRight: 0.0667,
  removeShortSpikes: 0,
};
