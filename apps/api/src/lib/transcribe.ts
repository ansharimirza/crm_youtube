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

export async function transcribeWords(audioPath: string): Promise<TranscriptWord[]> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY belum diatur di server (untuk transcribe/sync)')

  if (!(await Bun.file(audioPath).exists())) throw new Error(`Audio tidak ditemukan: ${audioPath}`)
  const smallPath = await downsample(audioPath)

  const form = new FormData()
  form.append('file', Bun.file(smallPath), 'audio.mp3')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('temperature', '0')

  try {
    const res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Groq transcribe HTTP ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = (await res.json()) as { words?: TranscriptWord[]; segments?: { words?: TranscriptWord[] }[] }
    // Word timestamps live at top level (verbose_json + word granularity); fall back to segments.
    let words = data.words ?? []
    if (words.length === 0 && data.segments) words = data.segments.flatMap((s) => s.words ?? [])
    if (words.length === 0) throw new Error('Transcribe sukses tapi tidak ada word timestamps')
    return words.map((w) => ({ word: w.word, start: w.start, end: w.end }))
  } finally {
    await rm(smallPath, { force: true }).catch(() => {})
  }
}
