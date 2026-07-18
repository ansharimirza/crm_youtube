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
  const K = 5 // opening words used to anchor
  const WINDOW = 500 // generous forward search so accumulated drift can still be caught

  // Pass 1: strongly anchor each beat whose opening words clearly match ahead of a running
  // pointer. Weak/failed matches are left un-pinned (-1) to be interpolated — this stops a
  // bad anchor from cascading and dumping the whole tail on the last scene.
  const starts = new Array<number>(N).fill(-1)
  let p = 0
  for (let i = 0; i < N; i++) {
    const opening = beatToks[i].slice(0, K)
    if (opening.length === 0) continue
    let bestScore = 0
    let bestQ = -1
    const hi = Math.min(TW.length - 1, p + WINDOW)
    for (let q = p; q <= hi; q++) {
      let score = 0
      for (let j = 0; j < opening.length && q + j < TW.length; j++) if (TW[q + j].tok === opening[j]) score++
      if (score > bestScore) { bestScore = score; bestQ = q; if (score === opening.length) break }
    }
    if (bestQ >= 0 && bestScore >= Math.min(2, opening.length)) {
      starts[i] = TW[bestQ].start
      p = bestQ + Math.max(1, beatToks[i].length)
    }
  }
  if (starts[0] < 0) starts[0] = TW[0].start

  // Pass 2: fill un-pinned beats by linear interpolation (by index) between neighbouring pins.
  for (let i = 0; i < N; i++) {
    if (starts[i] >= 0) continue
    let j = i
    while (j < N && starts[j] < 0) j++
    const prev = i - 1 >= 0 ? starts[i - 1] : TW[0].start
    const nextT = j < N ? starts[j] : audioDuration
    const gaps = j - (i - 1)
    for (let k = i; k < j; k++) starts[k] = prev + ((nextT - prev) * (k - (i - 1))) / gaps
    i = j - 1
  }

  // Enforce monotonic non-decreasing starts, then derive durations.
  for (let i = 1; i < N; i++) if (starts[i] < starts[i - 1]) starts[i] = starts[i - 1]
  const durations = new Array<number>(N)
  for (let i = 0; i < N; i++) {
    const next = i + 1 < N ? starts[i + 1] : audioDuration
    durations[i] = Math.max(0.3, next - starts[i])
  }
  return durations
}
