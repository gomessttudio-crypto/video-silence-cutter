import type { SilenceSegment } from './types'

/**
 * Mescla silêncios separados por blips de áudio curtos.
 * Se gap entre dois silêncios < removeShortSpikes → mesclar em um.
 * Se removeShortSpikes = 0 → retorna silences sem alteração.
 *
 * Arquivo sem dependências de Node.js — pode ser importado em componentes 'use client'.
 */
export function mergeSilences(
  silences: SilenceSegment[],
  removeShortSpikes: number
): SilenceSegment[] {
  if (removeShortSpikes <= 0 || silences.length < 2) return silences

  const merged: SilenceSegment[] = []
  let current = { ...silences[0] }

  for (let i = 1; i < silences.length; i++) {
    const next = silences[i]
    const gap = next.start - current.end

    if (gap < removeShortSpikes) {
      current.end = next.end
    } else {
      merged.push(current)
      current = { ...next }
    }
  }
  merged.push(current)

  return merged
}

/**
 * Aplica padding nos silêncios detectados.
 * Encolhe cada silêncio: start += paddingLeft, end -= paddingRight.
 * Descarta silêncios onde end <= start após padding.
 *
 * Arquivo sem dependências de Node.js — pode ser importado em componentes 'use client'.
 */
export function applyPadding(
  silences: SilenceSegment[],
  paddingLeft: number,
  paddingRight: number
): SilenceSegment[] {
  return silences
    .map((s) => ({
      start: s.start + paddingLeft,
      end: s.end - paddingRight,
    }))
    .filter((s) => s.end > s.start)
}
