// Google Cloud Text-to-Speech (the dedicated TTS product, NOT the rate-capped Gemini
// preview model). Free tier: 1M Neural2 characters/month — plenty for routine production.
// Uses the same Google API key (Settings → Gemini API Key); the key's project must have
// the "Cloud Text-to-Speech API" enabled and the key must not be API-restricted away from it.

import { writeFile } from 'node:fs/promises'

// High-quality Neural2 voices (en-US + en-GB). Default = a deep, documentary-style male.
export const GCLOUD_VOICES = [
  'en-US-Neural2-D', 'en-US-Neural2-J', 'en-US-Neural2-A', 'en-US-Neural2-I',
  'en-US-Neural2-C', 'en-US-Neural2-F', 'en-US-Neural2-G', 'en-US-Neural2-H',
  'en-GB-Neural2-B', 'en-GB-Neural2-A',
]
export const DEFAULT_GCLOUD_VOICE = 'en-US-Neural2-J'

export function isGCloudVoice(v?: string | null): boolean {
  return !!v && (GCLOUD_VOICES.includes(v) || /^[a-z]{2}-[A-Z]{2}-(Neural2|Wavenet|Standard|Studio)-\w/.test(v))
}

async function ffprobeDuration(path: string): Promise<number> {
  const proc = Bun.spawn(
    ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const out = await new Response(proc.stdout).text()
  await proc.exited
  const d = parseFloat(out.trim())
  if (!isFinite(d) || d <= 0) throw new Error('Durasi audio tidak terbaca')
  return d
}

// Synthesize text to an MP3 file via Google Cloud TTS. Returns exact duration.
export async function generateSpeechGCloudToFile(opts: {
  apiKey: string
  text: string
  outPath: string
  voice?: string
}): Promise<{ durationSec: number }> {
  const name = isGCloudVoice(opts.voice) ? opts.voice! : DEFAULT_GCLOUD_VOICE
  const languageCode = name.split('-').slice(0, 2).join('-') // e.g. "en-US"

  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${opts.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: opts.text },
      voice: { languageCode, name },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Cloud TTS HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = (await res.json()) as { audioContent?: string }
  if (!data.audioContent) throw new Error('Google Cloud TTS: no audioContent in response')

  await writeFile(opts.outPath, Buffer.from(data.audioContent, 'base64'))
  const durationSec = await ffprobeDuration(opts.outPath)
  return { durationSec }
}
