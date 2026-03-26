# PRD - Video Silence Cutter

## Stack Definida
- Next.js 15 (App Router)
- TypeScript
- ffmpeg-static ^5.2.0 (binário nativo no servidor)
- fluent-ffmpeg ^2.1.3 (wrapper Node.js)
- busboy ^1.3.0 (upload multipart streaming)
- react-dropzone (drag & drop, MIT, ~8kB)
- rc-slider (slider sensibilidade, MIT, ~173kB)
- @wavesurfer/react (timeline visual, MIT, ~13kB) — ou canvas nativo
- Tailwind CSS

## Hospedagem Recomendada
**Render (free tier)** — única plataforma com:
- FFmpeg nativo disponível (sem bundling complexo)
- Tempo de execução ilimitado (Vercel tem hard limit de 300s)
- 750h/mês gratuitas (cobre 24/7)
- RAM: 500MB (suficiente para vídeos de até ~150MB processados com streaming)
- Vercel descartado: limite de 4.5MB no body (impossível fazer upload de vídeo)
- Railway descartado: não tem free tier permanente (apenas $5 de trial)

## Arquitetura Geral

```
[Browser]
  ↓ drag & drop upload (react-dropzone)
  ↓ POST multipart/form-data (busboy streaming)
[Next.js API Route — /api/process]
  ↓ salva em /tmp/input-{uuid}.mp4
  ↓ detecta silêncios (FFmpeg silencedetect)
  ↓ gera timestamps de corte
  ↓ aplica "jump cuts" com select filter
  ↓ exporta /tmp/output-{uuid}.mp4
  ↓ SSE: emite progresso % em tempo real
  ↓ serve arquivo via /api/download?id={uuid}
[Browser]
  ↓ exibe preview (HTML5 <video> + Blob URL)
  ↓ mostra timeline com segmentos cortados
  ↓ botão download MP4 / MOV
  ↓ cleanup: deleta arquivos temporários
```

## Processamento FFmpeg

### Detecção de silêncios
```bash
ffmpeg -hide_banner -vn -i input.mp4 \
  -af "silencedetect=n=-50dB:d=1" \
  -f null - 2>&1
```
Saída: timestamps `silence_start` / `silence_end` no stderr.

### Remoção com "Jump Cuts" (vídeo + áudio)
```bash
ffmpeg -i input.mp4 \
  -vf "select='between(t,0,5.7)+between(t,11,18)',setpts=N/FRAME_RATE/TB" \
  -af "aselect='between(t,0,5.7)+between(t,11,18)',asetpts=N/SR/TB" \
  output.mp4
```

### Mapeamento do slider (0–100%) → parâmetros FFmpeg
| Slider | dB threshold (noise) | Duração mínima silêncio |
|--------|---------------------|------------------------|
| 0%     | -90dB (mais sensível) | 0.1s                  |
| 50%    | -50dB               | 1s                     |
| 100%   | -20dB (menos sensível)| 5s                   |

Fórmula dB: `dB = -90 + (slider / 100 * 70)`
Fórmula duração: `duration = 0.1 + (slider / 100 * 4.9)`

### Exportação
- **MP4**: `-c:v libx264 -crf 22 -preset fast -c:a aac -b:a 128k -movflags +faststart`
- **MOV**: mesmos parâmetros, container `.mov`

## Gerenciamento de Arquivos Temporários
- Local: `os.tmpdir()` → `/tmp/` no servidor
- Nomenclatura: `vsc-{uuid}-input.mp4`, `vsc-{uuid}-output.mp4`
- Cleanup: `try/finally` após envio da resposta (ou após download confirmado)
- Sem persistência: arquivos deletados logo após o download

## Fluxo de Preview
1. Cliente faz upload → API retorna `jobId`
2. Cliente abre `EventSource('/api/progress?id=jobId')` → recebe SSE com `{"progress": 0-100}`
3. FFmpeg emite progresso via `fluent-ffmpeg .on('progress', ...)`
4. Ao atingir 100%, API envia URL de preview
5. Cliente cria Blob URL com `URL.createObjectURL(blob)` e exibe `<video>`
6. Usuário clica em Download → requisição a `/api/download?id=jobId&format=mp4`

## Interface — Componentes Necessários
1. **UploadArea** — react-dropzone, aceita mp4/mov/webm, até 500MB, mostra progresso de upload
2. **ProcessingProgress** — barra de progresso (SSE), status em texto
3. **VideoPreview** — `<video>` nativo com controles, exibe resultado processado
4. **CutTimeline** — timeline visual mostrando segmentos cortados (canvas ou @wavesurfer/react)
5. **SensitivitySlider** — rc-slider 0–100%, debounce 300ms antes de reprocessar
6. **FormatSelector** — toggle MP4 / MOV
7. **DownloadButton** — inicia download do arquivo processado

## Estrutura de Pastas do Projeto

```
video-silence-cutter/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Página principal
│   │   ├── layout.tsx
│   │   └── api/
│   │       ├── process/route.ts        # Upload + processamento FFmpeg
│   │       ├── progress/route.ts       # SSE de progresso
│   │       └── download/route.ts       # Serve arquivo processado
│   ├── components/
│   │   ├── UploadArea.tsx
│   │   ├── ProcessingProgress.tsx
│   │   ├── VideoPreview.tsx
│   │   ├── CutTimeline.tsx
│   │   ├── SensitivitySlider.tsx
│   │   ├── FormatSelector.tsx
│   │   └── DownloadButton.tsx
│   └── lib/
│       ├── ffmpeg.ts                   # Wrapper fluent-ffmpeg
│       ├── silence-detection.ts        # Detecta e parseia silêncios
│       └── job-store.ts                # Estado em memória dos jobs (Map)
├── public/
├── next.config.ts                      # bodySizeLimit: '500mb'
├── PRD.md
└── package.json
```

## Limites e Restrições Técnicas
- Upload máximo: 500MB (configurar no next.config.ts)
- Duração máxima: 5 minutos
- Formatos de entrada: MP4, MOV, WebM
- Formatos de saída: MP4, MOV
- Tempo de processamento estimado: 15–60s para vídeo de 5min no Render free tier
- RAM Render: 500MB → vídeos de até ~150MB processados com streaming OK
- Concorrência: 1 processamento por vez no free tier (adicionar fila simples se necessário)

## Riscos & Edge Cases
| Risco | Mitigação |
|-------|-----------|
| Vídeo sem silêncios | Retornar vídeo original sem cortes, avisar usuário |
| Silêncios muito curtos (<0.1s) | Ignorar — parâmetro mínimo de duração |
| Arquivo muito grande (>500MB) | Validar no frontend antes do upload |
| Timeout no Render (cold start 15s) | Mostrar "preparando servidor..." |
| Cleanup falha e `/tmp` enche | Cron de limpeza de arquivos >1h no startup |
| Re-processamento rápido (slider) | Debounce 300ms + cancelar job anterior |

## Gaps / Decisões em Aberto
- [ ] Fila de jobs para múltiplos usuários simultâneos (vs. bloquear durante processamento)
- [ ] Persistência de jobs (reiniciar servidor perde os arquivos em /tmp)
- [ ] Limite de uso por IP para evitar abuso (rate limiting)
- [ ] Decisão final: waveform completo (wavesurfer.js) vs. timeline simplificada (canvas)
