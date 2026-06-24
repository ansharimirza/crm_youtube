// Speech-to-text with WORD-level timestamps, via Groq's free Whisper endpoint
// (OpenAI-compatible). Used to forced-align a full narration to the per-scene script
// so each image shows exactly when its line is spoken.

export interface TranscriptWord {
  word: string
  start: number // seconds
  end: number
}

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

export async function transcribeWords(audioPath: string): Promise<TranscriptWord[]> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY belum diatur di server (untuk transcribe/sync)')

  const file = Bun.file(audioPath)
  if (!(await file.exists())) throw new Error(`Audio tidak ditemukan: ${audioPath}`)

  const form = new FormData()
  form.append('file', file, audioPath.split('/').pop() || 'audio.mp3')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('temperature', '0')

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
}
