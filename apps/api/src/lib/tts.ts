// Gemini TTS — text → speech (narration voiceover) for the faceless-video pipeline.
// Output is raw 16-bit mono PCM @ 24kHz; we wrap it into a WAV for ffmpeg/players.
// Exact duration is derived from the PCM byte length (no ffprobe needed) — this
// duration is what drives clip trimming in the auto-edit step, so it must be exact.

import { writeFile } from 'node:fs/promises'

const BASE_URL = 'https://generativelanguage.googleapis.com'
const TTS_MODEL = 'gemini-2.5-flash-preview-tts'
const SAMPLE_RATE = 24000 // Gemini TTS: 24kHz, 16-bit, mono
const BYTES_PER_SAMPLE = 2 // 16-bit

export class TTSError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'TTSError'
    this.status = status
  }
}

export interface SpeechResult {
  pcm: Buffer
  durationSec: number
  sampleRate: number
}

// Generate speech and return raw PCM + exact duration.
export async function generateSpeech(params: {
  apiKey: string
  text: string
  voice?: string // prebuilt Gemini voice, e.g. 'Kore', 'Puck', 'Charon', 'Aoede'
  model?: string
}): Promise<SpeechResult> {
  const model = params.model ?? TTS_MODEL
  const voice = params.voice ?? 'Kore'

  const res = await fetch(`${BASE_URL}/v1beta/models/${model}:generateContent?key=${params.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: params.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new TTSError(`Gemini TTS failed: HTTP ${res.status} ${errText.slice(0, 300)}`, res.status)
  }

  const data = (await res.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>
  } | null

  const b64 = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
  if (!b64) throw new TTSError('Gemini TTS: no audio data in response')

  const pcm = Buffer.from(b64, 'base64')
  const durationSec = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)
  return { pcm, durationSec, sampleRate: SAMPLE_RATE }
}

// Minimal WAV (PCM) container header for 16-bit mono.
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // audio format = PCM
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// Generate speech and save as a .wav file; returns the path + exact duration.
export async function generateSpeechToFile(params: {
  apiKey: string
  text: string
  outPath: string
  voice?: string
  model?: string
}): Promise<{ path: string; durationSec: number }> {
  const { pcm, durationSec, sampleRate } = await generateSpeech(params)
  await writeFile(params.outPath, pcmToWav(pcm, sampleRate))
  return { path: params.outPath, durationSec }
}
