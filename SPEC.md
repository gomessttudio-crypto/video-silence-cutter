# SPEC - Video Silence Cutter

Documento técnico de especificação. Descreve contratos de API, tipos, componentes e ordem de implementação.

> Referência de UX: [Recut](https://getrecut.com/) — app desktop de referência para interface e parâmetros de detecção.

---

## 1. Visão Geral

Ferramenta web que recebe um vídeo (MP4/MOV/WebM), detecta automaticamente os trechos silenciosos via FFmpeg e exporta uma versão com esses trechos removidos ("jump cuts"). O usuário controla 4 parâmetros de detecção independentes (threshold, duração mínima, padding, remoção de spikes) e escolhe o formato de saída (MP4 ou MOV).

**Sem autenticação. Sem banco de dados. Processamento 100% server-side com arquivos temporários.**

---

## 2. Stack e Versões

| Tecnologia | Versão | Motivo |
|---|---|---|
| Next.js | 15 (App Router) | SSE nativo via Route Handlers, streaming de resposta |
| TypeScript | 5.x | Tipagem forte em toda a aplicação |
| ffmpeg-static | ^5.2.0 | Binário FFmpeg embutido, sem dependência de instalação externa |
| fluent-ffmpeg | ^2.1.3 | API Node.js para construir comandos FFmpeg |
| busboy | ^1.3.0 | Upload multipart streaming (sem bufferizar o arquivo inteiro na memória) |
| react-dropzone | latest | Drag & drop de arquivos, MIT ~8kB |
| rc-slider | latest | Sliders de controle, MIT ~173kB |
| @wavesurfer/react | latest | Waveform visual de áudio (ou canvas nativo como fallback) |
| Tailwind CSS | 3.x | Estilização |

**Hospedagem: Render (free tier)**
- FFmpeg nativo disponível
- Sem hard limit de tempo de execução (Vercel tem 300s)
- 750h/mês gratuitas = 24/7 coberto
- RAM 500MB suficiente para vídeos até ~150MB processados com streaming

---

## 3. Estrutura de Pastas

```
video-silence-cutter/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Página principal (orquestra todos os componentes)
│   │   ├── layout.tsx                  # Root layout com <html>, <body>, Tailwind globals
│   │   └── api/
│   │       ├── process/
│   │       │   └── route.ts            # POST: recebe upload multipart, inicia processamento
│   │       ├── progress/
│   │       │   └── route.ts            # GET: SSE com progresso do job
│   │       └── download/
│   │           └── route.ts            # GET: stream do arquivo de saída
│   ├── components/
│   │   ├── UploadArea.tsx              # Drag & drop, validação, progresso de upload
│   │   ├── DetectionSettings.tsx       # Painel de controles: threshold, duração, padding, spikes
│   │   ├── ProcessingProgress.tsx      # Barra de progresso SSE
│   │   ├── VideoPreview.tsx            # <video> nativo com Blob URL
│   │   ├── CutTimeline.tsx             # Timeline visual: azul = áudio, vermelho = silêncio cortado
│   │   ├── FormatSelector.tsx          # Toggle MP4 / MOV
│   │   └── DownloadButton.tsx          # Dispara download via /api/download
│   └── lib/
│       ├── types.ts                    # Todos os tipos TypeScript compartilhados
│       ├── ffmpeg.ts                   # applyJumpCuts(), invertSegments()
│       ├── silence-detection.ts        # detectSilences(), applyPadding(), mergeSilences()
│       └── job-store.ts               # Map em memória para estado dos jobs
├── public/
├── next.config.ts                      # bodySizeLimit 500mb
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── PRD.md
```

---

## 4. Parâmetros de Detecção

Inspirado no Recut, a detecção usa 4 parâmetros independentes (não um único slider de "sensibilidade"):

| Parâmetro | Tipo | Padrão | O que faz |
|---|---|---|---|
| `threshold` | `number` (amplitude 0–1) | `0.0156` | Nível abaixo do qual o áudio é considerado silêncio. 0 = completamente mudo, 1 = sinal máximo. Recut padrão: 0.0156 ≈ -36 dBFS |
| `minDuration` | `number` (segundos) | `0.5` | Silêncio deve durar pelo menos X segundos para ser cortado. Silêncios mais curtos são mantidos |
| `paddingLeft` | `number` (segundos) | `0.0667` | Buffer mantido antes do início de cada corte — evita cortes abruptos no início da fala |
| `paddingRight` | `number` (segundos) | `0.0667` | Buffer mantido após o fim de cada corte — evita cortes abruptos no fim da fala |
| `removeShortSpikes` | `number` (segundos) | `0` | Mescla silêncios separados por blips de áudio menores que X segundos. 0 = desabilitado |

### Conversão threshold → FFmpeg

FFmpeg aceita amplitude diretamente no filtro `silencedetect`:
```
n=0.0156
```
Ou equivalente em dB (para referência): `dB = 20 * Math.log10(0.0156)` ≈ `-36.1 dBFS`

**Usar amplitude diretamente** (sem converter para dB) — mais simples e sem perda de precisão.

---

## 5. Tipos TypeScript

Definir em `src/lib/types.ts` e importar nos outros módulos.

```typescript
export type JobStatus = 'uploading' | 'detecting' | 'processing' | 'done' | 'error';

export type OutputFormat = 'mp4' | 'mov';

export interface DetectionOptions {
  threshold: number;        // amplitude 0–1, padrão 0.0156
  minDuration: number;      // segundos, padrão 0.5
  paddingLeft: number;      // segundos, padrão 0.0667
  paddingRight: number;     // segundos, padrão 0.0667
  removeShortSpikes: number; // segundos, padrão 0 (desabilitado)
}

export interface ProcessOptions {
  detection: DetectionOptions;
  format: OutputFormat;
}

export interface SilenceSegment {
  start: number;  // segundos (já com padding aplicado)
  end: number;    // segundos (já com padding aplicado)
}

export interface CutSegment {
  start: number;  // segundos — segmento de ÁUDIO/VÍDEO a MANTER
  end: number;    // segundos
}

export interface Job {
  id: string;             // uuid v4
  status: JobStatus;
  progress: number;       // 0–100
  inputPath: string;      // /tmp/vsc-{id}-input.mp4
  outputPath: string;     // /tmp/vsc-{id}-output.{format}
  format: OutputFormat;
  totalDuration: number;  // duração original em segundos (preenchida após detecção)
  silences: SilenceSegment[]; // silêncios detectados (após padding)
  segments: CutSegment[]; // segmentos mantidos após corte
  error?: string;
  createdAt: number;      // Date.now()
}

// Payload enviado via SSE
export interface ProgressEvent {
  progress: number;       // 0–100
  status: JobStatus;
  totalDuration?: number;
  silences?: SilenceSegment[];
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
```

---

## 6. Especificação de APIs

### 6.1 `POST /api/process`

Recebe o vídeo + opções de processamento. Inicia o job em background e retorna o ID imediatamente.

**Request:**
```
Content-Type: multipart/form-data
Fields:
  - file: File (mp4 | mov | webm, máx 500MB)
  - threshold: string (número 0–1, ex: "0.0156")
  - minDuration: string (segundos, ex: "0.5")
  - paddingLeft: string (segundos, ex: "0.0667")
  - paddingRight: string (segundos, ex: "0.0667")
  - removeShortSpikes: string (segundos, ex: "0")
  - format: string ("mp4" | "mov")
```

**Response 200:**
```json
{ "jobId": "uuid-v4" }
```

**Response 400:**
```json
{ "error": "Arquivo inválido" | "Formato não suportado" | "Arquivo muito grande" }
```

**Fluxo interno:**
1. Parsear multipart via `busboy` (streaming → escreve direto em `/tmp/vsc-{id}-input.mp4`)
2. Criar `Job` no `job-store` com status `detecting`
3. Iniciar processamento em background (sem `await` no request handler — responde antes de terminar)
4. Retornar `{ jobId }`

---

### 6.2 `GET /api/progress?id={jobId}`

Server-Sent Events. O cliente abre e mantém a conexão aberta até receber `done` ou `error`.

**Headers de resposta:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Eventos SSE emitidos:**
```
data: {"progress":15,"status":"detecting"}

data: {"progress":50,"status":"processing"}

data: {"progress":100,"status":"done","totalDuration":120.5,"silences":[{"start":5.7,"end":11.0}],"segments":[{"start":0,"end":5.7},{"start":11,"end":120.5}]}

data: {"progress":0,"status":"error","error":"mensagem de erro"}
```

**Response 404:**
```json
{ "error": "Job não encontrado" }
```

---

### 6.3 `GET /api/download?id={jobId}&format={mp4|mov}`

Faz stream do arquivo de saída e depois deleta os temporários.

**Response 200:**
```
Content-Type: video/mp4 | video/quicktime
Content-Disposition: attachment; filename="output.mp4"
[stream binário do arquivo]
```

**Response 404:**
```json
{ "error": "Arquivo não encontrado" }
```

**Cleanup:** Após envio completo, deletar `inputPath` e `outputPath` do job.

---

## 7. Especificação de Componentes

### 7.1 `UploadArea`

```typescript
interface UploadAreaProps {
  onJobStart: (jobId: string) => void;
  options: ProcessOptions;
  disabled?: boolean;
}
```

**Estado interno:**
- `uploadProgress: number` — progresso do upload via `XMLHttpRequest.upload.onprogress`
- `error: string | null`

**Comportamento:**
- Aceita apenas `video/mp4`, `video/quicktime`, `video/webm`
- Valida tamanho no frontend antes do upload: rejeita se > 500MB
- Exibe drag overlay ao arrastar arquivo para a área
- Ao soltar/selecionar, faz `POST /api/process` com `XMLHttpRequest` (para ter progresso de upload)
- Envia os parâmetros de `options.detection` junto com o arquivo
- Ao receber `jobId`, chama `onJobStart(jobId)`

---

### 7.2 `DetectionSettings`

Painel de controles de detecção. Substitui o `SensitivitySlider` do spec original.

```typescript
interface DetectionSettingsProps {
  value: DetectionOptions;
  onChange: (options: DetectionOptions) => void;
  disabled?: boolean;
}
```

**Layout do painel (4 seções, inspirado no Recut):**

```
┌─────────────────────────────────────┐
│ Threshold                           │
│ Abaixo disso é considerado silêncio │
│ [————●————————————] [0.0156] [Auto] │
├─────────────────────────────────────┤
│ Minimum Duration                    │
│ Silêncios mais longos que isso      │
│ serão cortados.                     │
│ [————————————●————] [0,5] s         │
├─────────────────────────────────────┤
│ Padding                             │
│ Espaço deixado antes e após o corte │
│ [●——————] s [0,0667] 🔒 [0,0667] s  │
│   Esquerda            Direita       │
├─────────────────────────────────────┤
│ Remove Short Audio Spikes           │
│ Clips de áudio menores que isso     │
│ serão cortados.                     │
│ [●——————————————————] [0] s         │
└─────────────────────────────────────┘
```

**Comportamento:**
- Cada controle tem: slider `rc-slider` + input numérico editável lado a lado
- Alteração no slider atualiza o input e vice-versa
- Padding: ícone de cadeado 🔒 que, quando ativo (padrão), mantém Left = Right sincronizados
- Debounce de 400ms antes de chamar `onChange` (para evitar re-processamento em cada keystroke)
- Threshold: range 0.001–1, step 0.001; input aceita até 4 casas decimais
- MinDuration: range 0.1–10, step 0.1
- Padding: range 0–2, step 0.0167 (~1 frame a 60fps)
- RemoveShortSpikes: range 0–5, step 0.1; 0 = desabilitado (label: "Off")

---

### 7.3 `ProcessingProgress`

```typescript
interface ProcessingProgressProps {
  jobId: string;
  onDone: (result: { totalDuration: number; silences: SilenceSegment[]; segments: CutSegment[] }) => void;
  onError: (message: string) => void;
}
```

**Comportamento:**
- Abre `EventSource('/api/progress?id={jobId}')` ao montar
- Fecha `EventSource` ao desmontar (cleanup)
- Exibe barra de progresso 0–100% com texto de status
- Status texto: `detecting` → "Detectando silêncios...", `processing` → "Aplicando cortes...", `done` → "Concluído!"
- Ao receber `done`, chama `onDone({ totalDuration, silences, segments })`
- Ao receber `error`, chama `onError(message)`

---

### 7.4 `VideoPreview`

```typescript
interface VideoPreviewProps {
  jobId: string;
  format: OutputFormat;
}
```

**Comportamento:**
- Faz `fetch('/api/download?id={jobId}&format={format}')`, converte para Blob, cria `URL.createObjectURL(blob)`
- Exibe `<video controls src={blobUrl}>` com largura 100%
- Revoga a Blob URL ao desmontar (`URL.revokeObjectURL`)

---

### 7.5 `CutTimeline`

```typescript
interface CutTimelineProps {
  silences: SilenceSegment[];      // silêncios cortados
  totalDuration: number;           // duração original em segundos
}
```

**Comportamento:**
- Renderiza via `<canvas>`
- **Azul** = áudio mantido
- **Vermelho/rosa** = silêncio removido (mesma paleta do Recut)
- Escala proporcional à duração total
- Exibe timestamps nos extremos (0s e duração total em mm:ss)
- Tooltip ao hover: mostra o timestamp do ponto

---

### 7.6 `FormatSelector`

```typescript
interface FormatSelectorProps {
  value: OutputFormat;
  onChange: (format: OutputFormat) => void;
  disabled?: boolean;
}
```

**Comportamento:**
- Toggle visual entre "MP4" e "MOV"
- Botão ativo com fundo destacado

---

### 7.7 `DownloadButton`

```typescript
interface DownloadButtonProps {
  jobId: string;
  format: OutputFormat;
  disabled?: boolean;
}
```

**Comportamento:**
- Ao clicar, cria `<a href="/api/download?id={jobId}&format={format}" download>` e simula clique
- Desabilitado enquanto `disabled={true}`

---

## 8. Especificação das Libs

### 8.1 `src/lib/silence-detection.ts`

```typescript
/**
 * Detecta silêncios brutos no arquivo de entrada via FFmpeg silencedetect.
 * Retorna os intervalos RAW (sem padding aplicado).
 */
export async function detectSilencesRaw(
  inputPath: string,
  threshold: number,   // amplitude 0–1
  minDuration: number  // segundos
): Promise<{ silences: SilenceSegment[]; totalDuration: number }>

/**
 * Aplica padding nos silêncios detectados.
 * Encolhe cada silêncio: start += paddingLeft, end -= paddingRight.
 * Descarta silêncios onde end <= start após padding.
 */
export function applyPadding(
  silences: SilenceSegment[],
  paddingLeft: number,
  paddingRight: number
): SilenceSegment[]

/**
 * Mescla silêncios separados por blips de áudio curtos.
 * Se gap entre dois silêncios < removeShortSpikes → mesclar em um.
 * Se removeShortSpikes = 0 → retorna silences sem alteração.
 */
export function mergeSilences(
  silences: SilenceSegment[],
  removeShortSpikes: number
): SilenceSegment[]

/**
 * Pipeline completo: detecta → mescla spikes → aplica padding.
 */
export async function detectSilences(
  inputPath: string,
  options: DetectionOptions
): Promise<{ silences: SilenceSegment[]; totalDuration: number }>
```

**Comando FFmpeg para detecção:**
```bash
ffmpeg -hide_banner -vn -i {inputPath} \
  -af "silencedetect=n={threshold}:d={minDuration}" \
  -f null - 2>&1
```

**Ordem de processamento dos silêncios:**
1. `detectSilencesRaw()` → silêncios brutos
2. `mergeSilences(silences, removeShortSpikes)` → mescla blips (**antes** do padding, para não perder referência)
3. `applyPadding(silences, paddingLeft, paddingRight)` → silêncios finais

**Parser do stderr:**
- `silence_start: {n}` → regex `/silence_start: ([\d.]+)/`
- `silence_end: {n}` → regex `/silence_end: ([\d.]+)/`
- Duração total: regex `/Duration: (\d+):(\d+):([\d.]+)/` no inicio do output

---

### 8.2 `src/lib/ffmpeg.ts`

```typescript
/**
 * Inverte os segmentos de silêncio para obter os segmentos a MANTER.
 * Ex: silences=[{0,5},{10,15}], duration=20 → keeps=[{5,10},{15,20}]
 */
export function invertSegments(
  silences: SilenceSegment[],
  totalDuration: number
): CutSegment[]

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
): Promise<void>
```

**Construção do filtro FFmpeg (quando há cortes):**
```
selectFilter = segments.map(s => `between(t,${s.start},${s.end})`).join('+')

ffmpeg -i input.mp4 \
  -vf "select='{selectFilter}',setpts=N/FRAME_RATE/TB" \
  -af "aselect='{selectFilter}',asetpts=N/SR/TB" \
  -c:v libx264 -crf 22 -preset fast \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  output.mp4
```

**Caso especial — sem silêncios (vídeo idêntico ao original):**
```bash
ffmpeg -i input.mp4 -c copy output.mp4
```

**Flags de exportação:**
- MP4: `-c:v libx264 -crf 22 -preset fast -c:a aac -b:a 128k -movflags +faststart`
- MOV: mesmos codecs, container `.mov` (sem `-movflags +faststart`)

---

### 8.3 `src/lib/job-store.ts`

```typescript
/**
 * Store em memória (Map). Uma única instância no processo Node.js.
 * Jobs são perdidos ao reiniciar o servidor — aceitável para MVP.
 */

export function createJob(id: string, inputPath: string, format: OutputFormat): Job

export function getJob(id: string): Job | undefined

export function updateJob(id: string, updates: Partial<Job>): void

export function deleteJob(id: string): void

/** Deleta jobs criados há mais de 1h e remove seus arquivos temporários */
export function cleanupOldJobs(): void
```

---

## 9. Configurações

### `next.config.ts`

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
}

export default nextConfig
```

### Variáveis de Ambiente

Nenhuma obrigatória para o MVP. Opcionais:

| Variável | Padrão | Uso |
|---|---|---|
| `MAX_FILE_SIZE_MB` | `500` | Limite de upload (validação server-side) |
| `MAX_DURATION_SECONDS` | `300` | Duração máxima do vídeo (5 min) |

---

## 10. Limites e Restrições

| Limite | Valor |
|---|---|
| Tamanho máximo de upload | 500MB |
| Duração máxima do vídeo | 5 minutos |
| Formatos de entrada | MP4, MOV, WebM |
| Formatos de saída | MP4, MOV |
| Concorrência | 1 job por vez no Render free tier |
| Tempo de expiração do job | 1 hora |

---

## 11. Edge Cases e Tratamento de Erros

| Situação | Comportamento |
|---|---|
| Vídeo sem silêncios detectados | `invertSegments` retorna um único segmento cobrindo a duração total. Usar `-c copy`. Exibir aviso: "Nenhum silêncio detectado. Vídeo original disponível para download." |
| Padding maior que o silêncio | `applyPadding` descarta o silêncio (end ≤ start). Resultado: esse trecho não é cortado |
| Arquivo > 500MB | Validar no frontend antes do upload (sem enviar). Exibir: "Arquivo muito grande. Máximo: 500MB." |
| Formato inválido | Rejeitar no frontend ao soltar o arquivo. Exibir: "Formato não suportado. Use MP4, MOV ou WebM." |
| Duração > 5min | Validar após detectar duração via FFmpeg no servidor. Emitir SSE de error |
| Cold start do Render (~15s) | Exibir "Preparando servidor..." enquanto o job não inicia progresso |
| Re-processamento (mudança de settings) | Debounce 400ms no `DetectionSettings`. Ao alterar settings após processamento concluído → novo `POST /api/process` com o mesmo arquivo |
| Cleanup falha | `cleanupOldJobs()` executado ao iniciar o servidor e a cada hora via `setInterval` |
| Job não encontrado | 404. Frontend exibe "Sessão expirada. Faça upload novamente." |
| FFmpeg exit code ≠ 0 | Capturar no `fluent-ffmpeg .on('error', ...)`. Emitir SSE de error. Deletar temporários |

---

## 12. Fluxo Completo (Referência)

```
[Browser]
  1. Usuário arrasta vídeo → UploadArea valida tipo e tamanho
  2. XMLHttpRequest POST /api/process (multipart + DetectionOptions)
     → exibe progresso de upload (%)
  3. Recebe { jobId }
  4. Abre EventSource GET /api/progress?id={jobId}
  5. ProcessingProgress exibe progresso SSE em tempo real
  6. Ao receber done:
     → VideoPreview faz fetch /api/download → Blob URL → <video>
     → CutTimeline renderiza silences no canvas (azul/vermelho)
     → DownloadButton fica ativo

[Next.js API]
  POST /api/process:
    → busboy stream → salva /tmp/vsc-{id}-input.{ext}
    → cria job no job-store
    → inicia processamento em background (sem await)
    → retorna { jobId }

  Background:
    1. detectSilences(inputPath, options)
       → detectSilencesRaw() → FFmpeg silencedetect → parse stderr
       → mergeSilences() → mescla blips curtos
       → applyPadding() → silêncios finais
       → job-store: status=detecting, silences, totalDuration
    2. invertSegments(silences, totalDuration) → CutSegment[]
    3. applyJumpCuts(inputPath, segments, outputPath, format, onProgress)
       → onProgress → job-store: progress 0-100
    4. job-store: status=done, segments

  GET /api/progress:
    → poll job-store a cada 500ms
    → emite SSE com progresso atual
    → ao detectar done ou error, emite evento final e fecha stream

  GET /api/download:
    → pipe ReadStream do outputPath
    → após envio: fs.unlink(inputPath) + fs.unlink(outputPath)
```

---

## 13. Checklist de Implementação

- [x] **Setup do projeto**
  - [x] package.json, tsconfig.json, tailwind.config.ts, postcss.config.mjs, next.config.ts
  - [x] Instalar: `ffmpeg-static fluent-ffmpeg busboy react-dropzone rc-slider uuid`
  - [x] Instalar tipos: `@types/fluent-ffmpeg @types/busboy @types/uuid`
  - [x] Configurar `next.config.ts` com bodySizeLimit 500mb

- [x] **Lib: tipos** (`src/lib/types.ts`) — incluindo `DEFAULT_DETECTION`

- [x] **Lib: job-store** (`src/lib/job-store.ts`)

- [x] **Lib: silence-detection** (`src/lib/silence-detection.ts`)
  - [x] `detectSilencesRaw()` com parser de stderr
  - [x] `mergeSilences()` para spikes
  - [x] `applyPadding()`
  - [x] `detectSilences()` como pipeline
  - [ ] Testar isoladamente com vídeo de teste

- [x] **Lib: ffmpeg** (`src/lib/ffmpeg.ts`)
  - [x] `invertSegments()`
  - [x] `applyJumpCuts()` com caso especial `-c copy`
  - [ ] Testar isoladamente

- [x] **API: `/api/process`** — upload + parsear DetectionOptions + iniciar job

- [x] **API: `/api/progress`** — SSE com poll a cada 500ms

- [x] **API: `/api/download`** — stream + cleanup

- [x] **Componentes** (ordem de complexidade crescente)
  - [x] `FormatSelector`
  - [x] `DownloadButton`
  - [x] `DetectionSettings` (com os 4 controles + cadeado de padding)
  - [x] `ProcessingProgress`
  - [x] `CutTimeline` (canvas azul/vermelho)
  - [x] `VideoPreview`
  - [x] `UploadArea`

- [x] **Página principal** (`src/app/page.tsx`) — orquestrar tudo

- [ ] **Testes manuais**
  - [ ] Upload de vídeo curto (< 30s) com silêncios
  - [ ] Ajustar threshold e verificar re-detecção
  - [ ] Ajustar padding e verificar que cortes ficam mais naturais
  - [ ] RemoveShortSpikes com vídeo que tem tosses/ruídos curtos
  - [ ] Download MP4 e MOV
  - [ ] Vídeo sem silêncios (deve retornar original com aviso)
  - [ ] Arquivo > 500MB (deve rejeitar no frontend)

- [ ] **Deploy no Render**
  - [ ] Build command: `npm run build`
  - [ ] Start command: `npm run start`
  - [ ] Verificar FFmpeg disponível no ambiente Render

---

## 14. Roadmap (fora do MVP)

- **Split on Silence (Sections)**: dividir o vídeo em múltiplos arquivos baseado em silêncios longos — mesma feature da aba "Sections" do Recut
- **Export para editores**: gerar XML/EDL para Adobe Premiere, DaVinci Resolve, Final Cut Pro
- **Multi-track**: processar múltiplas faixas de áudio em sync
- **Preview com skip**: player que pula silêncios em tempo real sem exportar
- **Override manual de segmentos**: clicar na timeline para forçar manter/cortar um trecho específico
- **Auto threshold**: analisar distribuição de frequências e sugerir threshold automaticamente
