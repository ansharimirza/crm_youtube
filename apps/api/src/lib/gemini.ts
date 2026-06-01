// Google Gemini API client untuk analisa video → prompt Veo

import { readFile, stat } from 'node:fs/promises'

const BASE_URL = 'https://generativelanguage.googleapis.com'
const MODEL = 'gemini-2.5-flash' // multimodal, support video, structured output

export interface AnalyzedScene {
  scene_number: number
  start_time: string         // "0:00"
  end_time: string           // "0:04"
  duration_suggested: number // 4, 6, 8
  veo_model_suggested: 'veo-2' | 'veo-3.1' | 'veo-3.1-fast' | 'veo-3.1-lite'
  image_prompt: string
  video_prompt: string
  mood: string
}

export interface AnalyzeResult {
  summary: string
  scenes: AnalyzedScene[]
}

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['summary', 'scenes'],
  properties: {
    summary: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'scene_number',
          'start_time',
          'end_time',
          'duration_suggested',
          'veo_model_suggested',
          'image_prompt',
          'video_prompt',
          'mood',
        ],
        properties: {
          scene_number: { type: 'integer' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          duration_suggested: { type: 'integer' },
          veo_model_suggested: { type: 'string', enum: ['veo-2', 'veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite'] },
          image_prompt: { type: 'string' },
          video_prompt: { type: 'string' },
          mood: { type: 'string' },
        },
      },
    },
  },
}

const ANALYZE_INSTRUCTION = `You are an expert at analyzing short-form viral videos (YouTube Shorts, TikTok, Reels) and breaking them down into scenes that can be recreated using AI video generation (Google Veo).

Analyze this video and split it into scenes based on cuts, transitions, or significant camera/subject changes. Auto-detect the natural number of scenes (typically 2-8 depending on length and editing).

For EACH scene, generate two complementary prompts in ENGLISH:

1. IMAGE PROMPT — A vivid, detailed description of the static composition that will be used to generate a starting reference image. Focus on:
   - Subject(s) and their appearance
   - Camera angle and framing (e.g., close-up, wide shot, overhead, POV)
   - Lighting (e.g., warm sunset, studio softbox, neon, harsh shadows)
   - Color palette and mood
   - Style descriptors (cinematic, documentary, vlog, anime, hyperrealistic, etc.)
   - Setting / background details
   Do NOT describe motion in image_prompt.

2. VIDEO PROMPT — A description of the MOTION and ACTION happening during the scene:
   - What moves and how (subject motion, camera motion, environmental motion)
   - Speed and rhythm (slow, fast, snappy, smooth)
   - Transitions or effects
   - Sound/audio cues if relevant
   Do NOT re-describe static composition in video_prompt.

Other fields:
- start_time / end_time: Format as "M:SS" (e.g., "0:04", "0:12")
- duration_suggested: Pick exactly one of: 4, 6, or 8 seconds based on actual scene length. Do not use any other value.
- veo_model_suggested:
  - "veo-2" for shorter scenes (4-6s) or 9:16 portrait
  - "veo-3.1" for premium quality 8s scenes needing best detail
  - "veo-3.1-fast" for snappy/fast-paced 8s scenes where speed matters
  - "veo-3.1-lite" if audio sync is important
- mood: 1-3 words (e.g., "energetic upbeat", "cinematic moody", "calm intimate")

Also provide a brief "summary" of the overall video (1-2 sentences).`

export class GeminiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
  }
}

// Upload file ke Gemini Files API → return URI
export async function uploadVideoToGemini(
  videoPath: string,
  mimeType: string,
  apiKey: string,
  displayName?: string
): Promise<{ uri: string; name: string }> {
  const fileSize = (await stat(videoPath)).size

  // Step 1: Start resumable upload
  const startRes = await fetch(`${BASE_URL}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(fileSize),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file: { display_name: displayName ?? videoPath.split('/').pop() ?? 'video' },
    }),
  })

  if (!startRes.ok) {
    const errText = await startRes.text()
    throw new GeminiError(`Upload start failed: ${errText}`, startRes.status)
  }
  const uploadUrl = startRes.headers.get('X-Goog-Upload-URL')
  if (!uploadUrl) throw new GeminiError('No upload URL returned')

  // Step 2: Upload bytes
  const fileBuf = await readFile(videoPath)
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(fileSize),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: new Uint8Array(fileBuf),
  })

  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    throw new GeminiError(`Upload failed: ${errText}`, uploadRes.status)
  }
  const fileData = await uploadRes.json() as { file: { uri: string; name: string; state: string } }
  if (!fileData.file?.uri) throw new GeminiError('Missing file URI in response')

  return { uri: fileData.file.uri, name: fileData.file.name }
}

// Tunggu file di Gemini state ACTIVE (processing → active)
export async function waitForFileActive(
  fileName: string,
  apiKey: string,
  maxWaitMs = 120_000
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${BASE_URL}/v1beta/${fileName}?key=${apiKey}`)
    if (!res.ok) throw new GeminiError(`Get file status failed: HTTP ${res.status}`)
    const data = await res.json() as { state: string }
    if (data.state === 'ACTIVE') return
    if (data.state === 'FAILED') throw new GeminiError('Gemini file processing FAILED')
    await new Promise(r => setTimeout(r, 2_000))
  }
  throw new GeminiError('Timeout waiting for file to be ACTIVE')
}

// ===== VIRALITY SCORE =====

export type ViralityEmotion = 'Kagum' | 'Lucu' | 'Edukasi' | 'Marah'

export interface ViralityCriterion {
  score: number       // 75-99
  analysis: string
}

export interface ViralityResult {
  total_score: number  // 75-99 weighted
  visual_audio_hook: ViralityCriterion
  pacing_retention: ViralityCriterion
  shareability: ViralityCriterion
  critical_seconds_analysis: string
  cut_recommendation: string
  predicted_emotion: ViralityEmotion
  summary: string
}

const VIRALITY_SCHEMA = {
  type: 'object',
  required: [
    'total_score', 'visual_audio_hook', 'pacing_retention', 'shareability',
    'critical_seconds_analysis', 'cut_recommendation', 'predicted_emotion', 'summary',
  ],
  properties: {
    total_score: { type: 'integer' },
    visual_audio_hook: {
      type: 'object',
      required: ['score', 'analysis'],
      properties: {
        score: { type: 'integer' },
        analysis: { type: 'string' },
      },
    },
    pacing_retention: {
      type: 'object',
      required: ['score', 'analysis'],
      properties: {
        score: { type: 'integer' },
        analysis: { type: 'string' },
      },
    },
    shareability: {
      type: 'object',
      required: ['score', 'analysis'],
      properties: {
        score: { type: 'integer' },
        analysis: { type: 'string' },
      },
    },
    critical_seconds_analysis: { type: 'string' },
    cut_recommendation: { type: 'string' },
    predicted_emotion: { type: 'string', enum: ['Kagum', 'Lucu', 'Edukasi', 'Marah'] },
    summary: { type: 'string' },
  },
}

const VIRALITY_INSTRUCTION = `Kamu adalah "AI Virality Score Engine".
Tugasmu adalah menilai draf video pendek (TikTok/Reels/Shorts) yang saya unggah dengan skor skala 75-99.

Gunakan bobot penilaian berikut:
- Visual & Audio Hook (35%): Apakah 3 detik pertama mengejutkan atau bikin penasaran?
- Pacing & Retention Risk (30%): Apakah ada bagian yang membosankan atau terlalu lambat?
- Shareability Trigger (35%): Apakah video memberikan nilai praktis atau emosi kuat sehingga orang mau membagikannya?

PENTING tentang skor:
1. Berikan score 75-99 untuk masing-masing subkomponen (visual_audio_hook, pacing_retention, shareability).
2. total_score HARUS = round(visual_audio_hook.score × 0.35 + pacing_retention.score × 0.30 + shareability.score × 0.35).
3. Pastikan total_score konsisten secara matematis. Jangan asal pilih angka.

Output yang wajib (Bahasa Indonesia):
- total_score: integer 75-99 (hasil weighted average)
- visual_audio_hook: { score (75-99), analysis (2-3 kalimat) }
- pacing_retention: { score (75-99), analysis (2-3 kalimat) }
- shareability: { score (75-99), analysis (2-3 kalimat) }
- critical_seconds_analysis: ulasan detail 3 detik pertama (3-4 kalimat)
- cut_recommendation: rekomendasi konkret di detik ke berapa harus dipotong/dipercepat (sebut timestamp spesifik)
- predicted_emotion: salah satu dari "Kagum", "Lucu", "Edukasi", "Marah"
- summary: ringkasan 1-2 kalimat`

export async function scoreVirality(
  fileUri: string,
  mimeType: string,
  apiKey: string
): Promise<ViralityResult> {
  const body = {
    contents: [
      {
        parts: [
          { fileData: { fileUri, mimeType } },
          { text: VIRALITY_INSTRUCTION },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: VIRALITY_SCHEMA,
      temperature: 0.3,
    },
  }

  const res = await fetch(
    `${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new GeminiError(`Virality scoring failed: ${errText}`, res.status)
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new GeminiError('No text in Gemini response')

  try {
    const parsed = JSON.parse(text) as ViralityResult
    // Clamp scores ke 75-99
    const clamp = (n: number) => Math.max(75, Math.min(99, Math.round(n)))
    parsed.total_score = clamp(parsed.total_score)
    parsed.visual_audio_hook.score = clamp(parsed.visual_audio_hook.score)
    parsed.pacing_retention.score = clamp(parsed.pacing_retention.score)
    parsed.shareability.score = clamp(parsed.shareability.score)
    return parsed
  } catch (err) {
    throw new GeminiError(`Failed to parse Gemini JSON: ${err instanceof Error ? err.message : err}`)
  }
}

export async function deleteGeminiFile(fileName: string, apiKey: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/v1beta/${fileName}?key=${apiKey}`, { method: 'DELETE' })
  } catch {
    // ignore — Gemini auto-cleans after 48 hours anyway
  }
}

// Call Gemini untuk analisa video & generate Veo prompts
export async function analyzeVideoForVeo(
  fileUri: string,
  mimeType: string,
  apiKey: string
): Promise<AnalyzeResult> {
  const body = {
    contents: [
      {
        parts: [
          { fileData: { fileUri, mimeType } },
          { text: ANALYZE_INSTRUCTION },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: RESPONSE_SCHEMA,
      temperature: 0.4,
    },
  }

  const res = await fetch(
    `${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new GeminiError(`Gemini analyze failed: ${errText}`, res.status)
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
      finishReason?: string
    }>
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new GeminiError('No text in Gemini response')

  try {
    const parsed = JSON.parse(text) as AnalyzeResult
    return parsed
  } catch (err) {
    throw new GeminiError(`Failed to parse Gemini JSON: ${err instanceof Error ? err.message : err}`)
  }
}
