// Speech-to-text with WORD-level timestamps, via Groq's free Whisper endpoint
// (OpenAI-compatible). Used to forced-align a full narration to the per-scene script
// so each image shows exactly when its line is spoken.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'

export interface TranscriptWord {
  word: string
  start: number // seconds
  end: number
}

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

// Downsample to 16kHz mono — what Whisper uses internally — to stay well under Groq's
// upload size limit (a long MP3 can exceed it; 16k mono is ~4MB for 16 min).
async function downsample(srcPath: string): Promise<string> {
  const out = join(tmpdir(), `groq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`)
  const proc = Bun.spawn(['ffmpeg', '-y', '-i', srcPath, '-ar', '16000', '-ac', '1', '-b:a', '32k', out], {
    stdout: 'ignore', stderr: 'pipe',
  })
  const err = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) throw new Error(`ffmpeg downsample gagal: ${err.slice(-300)}`)
  return out
}

export interface TranscriptSegment {
  text: string
  start: number
  end: number
}

interface GroqResult {
  text: string
  words: TranscriptWord[]
  segments: TranscriptSegment[]
}

// One Groq call → full text + word timestamps + segment timestamps.
async function groqTranscribe(audioPath: string): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY belum diatur di server (untuk transcribe/sync)')
  if (!(await Bun.file(audioPath).exists())) throw new Error(`Audio tidak ditemukan: ${audioPath}`)

  const smallPath = await downsample(audioPath)
  const form = new FormData()
  form.append('file', Bun.file(smallPath), 'audio.mp3')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')
  form.append('temperature', '0')

  try {
    const res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Groq transcribe HTTP ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = (await res.json()) as {
      text?: string
      words?: TranscriptWord[]
      segments?: (TranscriptSegment & { words?: TranscriptWord[] })[]
    }
    let words = data.words ?? []
    if (words.length === 0 && data.segments) words = data.segments.flatMap((s) => s.words ?? [])
    const segments = (data.segments ?? []).map((s) => ({ text: (s.text ?? '').trim(), start: s.start, end: s.end }))
    return { text: (data.text ?? '').trim(), words, segments }
  } finally {
    await rm(smallPath, { force: true }).catch(() => {})
  }
}

export async function transcribeWords(audioPath: string): Promise<TranscriptWord[]> {
  const { words } = await groqTranscribe(audioPath)
  if (words.length === 0) throw new Error('Transcribe sukses tapi tidak ada word timestamps')
  return words
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor((ms % 3_600_000) / 60_000))}:${p(Math.floor((ms % 60_000) / 1000))},${p(ms % 1000, 3)}`
}

// For the standalone Transcribe tool: plain text + SRT + timestamped segments.
export async function transcribeAudio(audioPath: string): Promise<{
  text: string
  srt: string
  segments: TranscriptSegment[]
}> {
  const { text, segments } = await groqTranscribe(audioPath)
  const srt = segments
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join('\n')
  return { text, srt, segments }
}
