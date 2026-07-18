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
  const wc = beatToks.map((t) => Math.max(1, t.length)) // word count per beat (for proportional fill)
  const cum = [0]
  for (let i = 0; i < N; i++) cum.push(cum[i] + wc[i]) // cum[i] = words before beat i

  const K = 4 // opening words that must ALL match to trust a pin
  const WINDOW = 400 // forward search; safe from false matches because we require a full K-gram

  // Pass 1: pin only beats whose full opening K-gram matches ahead of a running pointer.
  // These reliable anchors lock the timeline; a wrong wording just leaves a beat un-pinned.
  const pinTime = new Array<number>(N).fill(-1)
  let p = 0
  for (let i = 0; i < N; i++) {
    const opening = beatToks[i].slice(0, K)
    if (opening.length < 2) continue // too short to anchor safely
    const hi = Math.min(TW.length - 1, p + WINDOW)
    for (let q = p; q <= hi; q++) {
      let ok = true
      for (let j = 0; j < opening.length; j++) {
        if (q + j >= TW.length || TW[q + j].tok !== opening[j]) { ok = false; break }
      }
      if (ok) { pinTime[i] = TW[q].start; p = q + wc[i]; break }
    }
  }
  if (pinTime[0] < 0) pinTime[0] = TW[0].start

  // Pass 2: interpolate un-pinned beats between neighbouring pins, weighted by word count
  // (so a long beat gets proportionally more time). Sentinel end-pin = audioDuration.
  const pins: { i: number; t: number }[] = []
  for (let i = 0; i < N; i++) if (pinTime[i] >= 0) pins.push({ i, t: pinTime[i] })
  pins.push({ i: N, t: audioDuration })

  const starts = new Array<number>(N)
  for (let i = 0; i < pins[0].i; i++) starts[i] = pins[0].t // any beats before the first pin
  for (let s = 0; s < pins.length - 1; s++) {
    const A = pins[s]
    const B = pins[s + 1]
    const denom = cum[B.i] - cum[A.i] || 1
    for (let i = A.i; i < B.i; i++) starts[i] = A.t + ((B.t - A.t) * (cum[i] - cum[A.i])) / denom
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
