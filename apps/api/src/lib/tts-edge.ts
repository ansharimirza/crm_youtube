// Free neural TTS via Microsoft Edge's "read aloud" service — no API key, no quota
// wall (unlike Gemini's preview TTS). Used widely by faceless channels. Outputs MP3.
//
// Protocol: open a WebSocket to the Edge synthesize endpoint with a time-based
// Sec-MS-GEC token, send the audio config + SSML, then collect the streamed audio
// frames (each binary frame = 2-byte big-endian header length, header, audio bytes).

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const SEC_MS_GEC_VERSION = '1-130.0.2849.68'
const WIN_EPOCH = 11644473600 // seconds between 1601-01-01 and 1970-01-01

export const EDGE_VOICES = [
  'en-US-AndrewNeural', 'en-US-AriaNeural', 'en-US-GuyNeural', 'en-US-ChristopherNeural',
  'en-US-EricNeural', 'en-US-RogerNeural', 'en-US-SteffanNeural', 'en-US-JennyNeural',
  'en-GB-RyanNeural', 'en-GB-SoniaNeural',
]
export const DEFAULT_EDGE_VOICE = 'en-US-AndrewNeural'

export function isEdgeVoice(v?: string | null): boolean {
  return !!v && (EDGE_VOICES.includes(v) || /^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(v))
}

// Token = uppercase SHA-256 of (Windows-filetime ticks rounded down to 5 min + trusted token)
function genSecMsGec(): string {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH
  ticks -= ticks % 300 // round down to a 5-minute boundary
  ticks *= 10_000_000 // seconds → 100-nanosecond units
  return createHash('sha256').update(`${ticks}${TRUSTED_TOKEN}`, 'ascii').digest('hex').toUpperCase()
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
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

// Synthesize `text` to an MP3 file. Returns the exact duration (ffprobe).
export async function generateSpeechEdgeToFile(opts: {
  text: string
  outPath: string
  voice?: string
}): Promise<{ durationSec: number }> {
  const voice = isEdgeVoice(opts.voice) ? opts.voice! : DEFAULT_EDGE_VOICE
  const url =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_TOKEN}&Sec-MS-GEC=${genSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`

  const audio = await new Promise<Buffer>((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const chunks: Buffer[] = []
    const timer = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('Edge TTS timeout')) }, 60_000)

    ws.onopen = () => {
      ws.send(
        `X-Timestamp:${new Date().toUTCString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`,
      )
      const reqId = crypto.randomUUID().replace(/-/g, '')
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'><prosody rate='0%' pitch='0%'>${escapeXml(opts.text)}</prosody></voice></speak>`
      ws.send(
        `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toUTCString()}\r\nPath:ssml\r\n\r\n${ssml}`,
      )
    }

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        if (ev.data.includes('Path:turn.end')) {
          clearTimeout(timer)
          try { ws.close() } catch {}
          if (chunks.length === 0) reject(new Error('Edge TTS: no audio received'))
          else resolve(Buffer.concat(chunks))
        }
        return
      }
      // binary frame: [2-byte BE header length][header][audio]
      const buf = Buffer.from(ev.data as ArrayBuffer)
      const headerLen = buf.readUInt16BE(0)
      const header = buf.subarray(2, 2 + headerLen).toString('utf8')
      if (header.includes('Path:audio')) chunks.push(buf.subarray(2 + headerLen))
    }

    ws.onerror = () => { clearTimeout(timer); reject(new Error('Edge TTS websocket error')) }
  })

  await writeFile(opts.outPath, audio)
  const durationSec = await ffprobeDuration(opts.outPath)
  return { durationSec }
}
