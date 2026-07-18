// Forced alignment: given the ordered per-beat scripts and the audio's word-level
// timestamps, work out exactly when each beat starts — so each image can be cut to
// the precise span its line is spoken. Robust to ASR noise: each beat is anchored by
// matching its opening words against the transcript, advancing a running pointer.

import type { TranscriptWord } from './transcribe'

const normTok = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)

// Returns the screen-time duration (seconds) for each beat, summing to ~audioDuration.
export function alignBeats(
  beats: { text: string }[],
  words: TranscriptWord[],
  audioDuration: number,
): number[] {
  const N = beats.length
  if (N === 0) return []

  // Flatten transcript into normalized tokens, each carrying its spoken start time.
  const TW: { tok: string; start: number }[] = []
  for (const w of words) {
    for (const t of normTok(w.word)) TW.push({ tok: t, start: w.start })
  }
  if (TW.length === 0) {
    // No usable transcript → equal split as a last resort.
    return new Array<number>(N).fill(Math.max(0.5, audioDuration / N))
  }

  const beatToks = beats.map((b) => normTok(b.text))
  const starts = new Array<number>(N).fill(0)
  const WINDOW = 120 // forward search — wide enough to catch drift, narrow enough to avoid false far-matches
  const K = 4 // opening words used to anchor

  let p = 0
  for (let i = 0; i < N; i++) {
    if (i === 0) {
      starts[0] = TW[0].start
      p = beatToks[0].length
      continue
    }
    const opening = beatToks[i].slice(0, Math.min(K, beatToks[i].length))
    let bestQ = Math.min(p, TW.length - 1)
    let bestScore = -1
    const hi = Math.min(TW.length - 1, p + WINDOW)
    for (let q = Math.max(0, p - 3); q <= hi; q++) {
      let score = 0
      for (let j = 0; j < opening.length && q + j < TW.length; j++) {
        if (TW[q + j].tok === opening[j]) score++
      }
      if (score > bestScore) { bestScore = score; bestQ = q }
      if (opening.length > 0 && score === opening.length) break
    }
    starts[i] = TW[bestQ].start
    p = Math.min(TW.length - 1, bestQ + Math.max(1, beatToks[i].length))
  }

  // Enforce monotonic non-decreasing starts, then derive durations.
  for (let i = 1; i < N; i++) if (starts[i] < starts[i - 1]) starts[i] = starts[i - 1]
  const durations = new Array<number>(N)
  for (let i = 0; i < N; i++) {
    const next = i + 1 < N ? starts[i + 1] : audioDuration
    durations[i] = Math.max(0.5, next - starts[i])
  }
  return durations
}
