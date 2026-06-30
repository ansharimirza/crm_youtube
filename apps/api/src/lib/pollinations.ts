// Free, keyless image generation via Pollinations (https://pollinations.ai).
// A $0 alternative to GeminiGen/Nano Banana for the faceless image-mode pipeline.
// Returns JPEG bytes. The free tier rate-limits concurrency (~1 request per IP), so
// callers MUST generate sequentially (see runScenePool concurrency for 'pollinations').

const POLL_BASE = 'https://image.pollinations.ai/prompt'

// The free tier serves the "sana" model, which defaults to polished COLOR illustrations
// and ignores soft style hints. Force the channel's black-marker doodle look with a hard
// style prefix on every prompt (verified: turns colored renders into clean B/W line art).
const DOODLE_PREFIX =
  'black ink marker doodle on plain white paper, pure black and white line art, bold clean outlines, no color, no shading, no gray fill, plain white background, simple childlike sketch: '

// The free tier caps 16:9 output at ~1024x576 regardless of requested size; the
// ffmpeg assembler scales each still up to the final video resolution anyway.
export async function generatePollinationsImage(
  prompt: string,
  aspectRatio: '16:9' | '9:16' = '16:9',
): Promise<Buffer> {
  const [w, h] = aspectRatio === '9:16' ? [576, 1024] : [1024, 576]
  const seed = Math.floor(Math.random() * 1_000_000_000)
  // Trim very long prompts so the request URL stays well under server path limits.
  const params = new URLSearchParams({
    width: String(w),
    height: String(h),
    nologo: 'true',
    model: 'flux',
    seed: String(seed),
  })
  const styled = DOODLE_PREFIX + prompt.slice(0, 1300)
  const url = `${POLL_BASE}/${encodeURIComponent(styled)}?${params}`

  let lastErr = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > 1000 && (res.headers.get('content-type') || '').startsWith('image/')) return buf
        lastErr = `respons bukan gambar (${buf.length}B, ${res.headers.get('content-type')})`
      } else {
        lastErr = `HTTP ${res.status}`
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 4000)) // 4s, 8s, 12s backoff
  }
  throw new Error(`Pollinations gagal generate gambar: ${lastErr}`)
}
