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

export type Platform = 'tiktok' | 'reels' | 'shorts'

export type ViralityEmotion =
  | 'Kagum' | 'Lucu' | 'Edukasi' | 'Marah'
  | 'Penasaran' | 'Inspiratif' | 'Relatable' | 'Shock'

export type HookPattern =
  | 'Bold Claim'
  | 'Curiosity Gap'
  | 'Micro-Story'
  | 'Visual Shock'
  | 'Direct Question'
  | 'None'

export interface ViralityCriterion {
  score: number       // 0-99
  analysis: string
  detected_signals: string[]
}

export interface SteppsItem {
  hit: boolean
  note: string
}

export interface SteppsBreakdown {
  social_currency: SteppsItem
  triggers: SteppsItem
  emotion: SteppsItem
  public: SteppsItem
  practical_value: SteppsItem
  stories: SteppsItem
}

export interface HookDiagnosis {
  pattern_detected: HookPattern
  strength_indicators: string[]
  weakness_indicators: string[]
}

export interface CutRecommendation {
  timestamp_start: string  // "0:08"
  timestamp_end: string
  issue: string
  action: string
  reason: string
}

export interface AlternativeHook {
  pattern: HookPattern
  text: string
}

export interface PredictedEmotion {
  primary: ViralityEmotion
  arc_description: string
}

export interface ViralityResult {
  total_score: number
  criteria: {
    hook_strength: ViralityCriterion        // 30%
    pacing_retention: ViralityCriterion     // 20%
    emotional_payload: ViralityCriterion    // 20%
    shareability: ViralityCriterion         // 20%
    platform_fit: ViralityCriterion         // 10%
  }
  hook_diagnosis: HookDiagnosis
  cut_recommendations: CutRecommendation[]
  stepps_breakdown: SteppsBreakdown
  predicted_emotion: PredictedEmotion
  predicted_completion_rate: number  // 0-100 (estimasi % yg nonton sampai akhir)
  alternative_hooks: AlternativeHook[]
  summary: string
}

const HOOK_PATTERNS = ['Bold Claim', 'Curiosity Gap', 'Micro-Story', 'Visual Shock', 'Direct Question', 'None']
const EMOTIONS = ['Kagum', 'Lucu', 'Edukasi', 'Marah', 'Penasaran', 'Inspiratif', 'Relatable', 'Shock']

const criterionSchema = {
  type: 'object',
  required: ['score', 'analysis', 'detected_signals'],
  properties: {
    score: { type: 'integer' },
    analysis: { type: 'string' },
    detected_signals: { type: 'array', items: { type: 'string' } },
  },
}

const steppsItemSchema = {
  type: 'object',
  required: ['hit', 'note'],
  properties: {
    hit: { type: 'boolean' },
    note: { type: 'string' },
  },
}

const VIRALITY_SCHEMA = {
  type: 'object',
  required: [
    'total_score', 'criteria', 'hook_diagnosis', 'cut_recommendations',
    'stepps_breakdown', 'predicted_emotion', 'predicted_completion_rate',
    'alternative_hooks', 'summary',
  ],
  properties: {
    total_score: { type: 'integer' },
    criteria: {
      type: 'object',
      required: ['hook_strength', 'pacing_retention', 'emotional_payload', 'shareability', 'platform_fit'],
      properties: {
        hook_strength: criterionSchema,
        pacing_retention: criterionSchema,
        emotional_payload: criterionSchema,
        shareability: criterionSchema,
        platform_fit: criterionSchema,
      },
    },
    hook_diagnosis: {
      type: 'object',
      required: ['pattern_detected', 'strength_indicators', 'weakness_indicators'],
      properties: {
        pattern_detected: { type: 'string', enum: HOOK_PATTERNS },
        strength_indicators: { type: 'array', items: { type: 'string' } },
        weakness_indicators: { type: 'array', items: { type: 'string' } },
      },
    },
    cut_recommendations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['timestamp_start', 'timestamp_end', 'issue', 'action', 'reason'],
        properties: {
          timestamp_start: { type: 'string' },
          timestamp_end: { type: 'string' },
          issue: { type: 'string' },
          action: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    stepps_breakdown: {
      type: 'object',
      required: ['social_currency', 'triggers', 'emotion', 'public', 'practical_value', 'stories'],
      properties: {
        social_currency: steppsItemSchema,
        triggers: steppsItemSchema,
        emotion: steppsItemSchema,
        public: steppsItemSchema,
        practical_value: steppsItemSchema,
        stories: steppsItemSchema,
      },
    },
    predicted_emotion: {
      type: 'object',
      required: ['primary', 'arc_description'],
      properties: {
        primary: { type: 'string', enum: EMOTIONS },
        arc_description: { type: 'string' },
      },
    },
    predicted_completion_rate: { type: 'integer' },
    alternative_hooks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['pattern', 'text'],
        properties: {
          pattern: { type: 'string', enum: HOOK_PATTERNS },
          text: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

function buildPlatformContext(p: Platform): string {
  switch (p) {
    case 'tiktok':
      return `Platform target: TikTok.
- Algoritma TikTok memprioritaskan completion rate (>80% = boost agresif), shares, lalu comments.
- Pakai trending audio = signal kuat.
- Test pada 100-500 user dalam 3 jam pertama.
- Format optimal: 9:16 vertical, 15-60 detik, captions on-screen, hook visual + audio dalam 1 detik.`
    case 'reels':
      return `Platform target: Instagram Reels.
- Algoritma Reels memprioritaskan likes + shares + saves + watch time, lebih visual-first.
- Trending audio + ratusan-hashtag spesifik penting.
- Re-shareability ke Stories meningkatkan reach.
- Format optimal: 9:16, 15-90 detik, audio musik terkenal, hook visual yang dramatis.`
    case 'shorts':
      return `Platform target: YouTube Shorts.
- Algoritma Shorts memprioritaskan retention curve & re-watch rate.
- CTR thumbnail/first frame penting karena ada feed Shorts terpisah.
- Suara/voiceover lebih besar weight dibanding TikTok (banyak user nonton dengan audio on).
- Format optimal: 9:16, 15-60 detik, hook verbal + visual, jelas info-density.`
  }
}

function buildViralityInstruction(platform: Platform): string {
  return `Kamu adalah "AI Virality Score Engine" — alat ahli yang menilai potensi viral video pendek.

${buildPlatformContext(platform)}

═══════════════════════════════════════════════════
LANGKAH BERPIKIR (lakukan internal step-by-step sebelum scoring):

STEP 1 — DESKRIPSI: Identifikasi apa yang terjadi di setiap segmen waktu:
  - 0:00-0:03 (Hook window — paling kritis)
  - 0:03-0:15 (Value drop)
  - 0:15-0:45 (Story/Payoff)
  - 0:45-end (Resolution/CTA)

STEP 2 — DIAGNOSTIK:
  - Hook pattern apa yang dipakai? (Bold Claim / Curiosity Gap / Micro-Story / Visual Shock / Direct Question / None)
  - Kapan ada dead air, redundancy, slow zoom, atau cliff drop di retention curve?
  - STEPPS mana yang kena? Mana yang miss?

STEP 3 — SCORING dengan rubric (gunakan sebagai anchor):

📍 HOOK STRENGTH (bobot 30%):
  - 90-99: Kata/visual pertama <0.5s, pattern interrupt jelas, curiosity gap tinggi, single clear promise
  - 75-89: Hook jelas tapi predictable, 1-2 elemen lemah
  - 60-74: Generic opener atau hook lambat (zoom-in panjang)
  - 40-59: "In this video..." style, vague clickbait
  - <40: Tidak ada hook, music intro panjang, no visual interest

📍 PACING & RETENTION (bobot 20%):
  - 90-99: Cut tight tiap 2-3 detik, no dead air, momentum naik bertahap
  - 75-89: Mostly tight, 1-2 slow moments minor
  - 60-74: Beberapa segmen lambat atau repetitive (3+ detik)
  - 40-59: Dead air >5 detik atau scene drag terus
  - <40: Pacing flat, viewer pasti drop off di tengah

📍 EMOTIONAL PAYLOAD (bobot 20%):
  - 90-99: High-arousal emotion dominan + buildup arc + payoff jelas
  - 75-89: Clear emotion tapi arc-nya flat
  - 60-74: Weak/mixed emotion, viewer netral
  - <60: Datar, tidak ada momen emosional

📍 SHAREABILITY / STEPPS (bobot 20%):
  - 90-99: 4+ STEPPS kena strong (Social Currency, Triggers, Emotion, Public, Practical Value, Stories)
  - 75-89: 2-3 STEPPS kena
  - 60-74: 1 STEPPS kena
  - <60: Personal interest only, tidak share-worthy

📍 PLATFORM FIT (bobot 10%):
  - 90-99: Vertical 9:16, captions, durasi optimal, trending audio (kalau ada), CTA jelas, all platform conventions match
  - 75-89: Compliant tapi 1 elemen kurang
  - 60-74: 2-3 format issue
  - <60: Wrong aspect ratio / horizontal / no captions

STEP 4 — KALKULASI:
  total_score = round(
    hook_strength × 0.30 +
    pacing_retention × 0.20 +
    emotional_payload × 0.20 +
    shareability × 0.20 +
    platform_fit × 0.10
  )
  PENTING: total_score WAJIB konsisten matematis dengan 5 subscore di atas. Jangan asal pilih.

STEP 5 — REKOMENDASI:
  - cut_recommendations: SETIAP item butuh timestamp_start & timestamp_end konkret (format M:SS), issue spesifik, action ("Cut", "Speed up 2x", "Trim 50%", "Replace with text overlay", "Add zoom-in"), dan reason.
  - alternative_hooks: 3 saran hook line dalam bahasa video (Indonesia/Inggris). Tiap pakai pola berbeda. Tulis kalimat lengkap yang siap dipakai.
  - predicted_emotion: pilih SATU dari [Kagum, Lucu, Edukasi, Marah, Penasaran, Inspiratif, Relatable, Shock]. Plus arc_description (bagaimana emosi naik-turun).
  - predicted_completion_rate: estimasi % viewer yang nonton sampai akhir (0-100). Ingat benchmark TikTok: >80% = viral potential, <40% = no viral.

═══════════════════════════════════════════════════
OUTPUT REQUIREMENTS:
- Semua text dalam Bahasa Indonesia kecuali alternative_hooks (ikuti bahasa video aslinya).
- detected_signals di tiap criteria: list spesifik observasi (e.g., "Pattern interrupt visual di 0:01", "Dead air 0:08-0:11", "Cut frekuensi tinggi").
- stepps_breakdown: setiap item butuh boolean "hit" + note penjelasan.
- Jangan inflate score — pakai rubric jujur. Kalau memang lemah, score-nya rendah.
- Score range valid: 0-99.`
}

export async function scoreVirality(
  fileUri: string,
  mimeType: string,
  apiKey: string,
  platform: Platform = 'tiktok',
): Promise<ViralityResult> {
  const body = {
    contents: [
      {
        parts: [
          { fileData: { fileUri, mimeType } },
          { text: buildViralityInstruction(platform) },
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
    const clamp = (n: number, lo = 0, hi = 99) => Math.max(lo, Math.min(hi, Math.round(n)))

    parsed.total_score = clamp(parsed.total_score)
    parsed.criteria.hook_strength.score = clamp(parsed.criteria.hook_strength.score)
    parsed.criteria.pacing_retention.score = clamp(parsed.criteria.pacing_retention.score)
    parsed.criteria.emotional_payload.score = clamp(parsed.criteria.emotional_payload.score)
    parsed.criteria.shareability.score = clamp(parsed.criteria.shareability.score)
    parsed.criteria.platform_fit.score = clamp(parsed.criteria.platform_fit.score)
    parsed.predicted_completion_rate = clamp(parsed.predicted_completion_rate, 0, 100)

    // Recompute total_score dari sub-scores untuk konsistensi (in case AI miskalkulasi)
    const recomputed = Math.round(
      parsed.criteria.hook_strength.score * 0.30 +
      parsed.criteria.pacing_retention.score * 0.20 +
      parsed.criteria.emotional_payload.score * 0.20 +
      parsed.criteria.shareability.score * 0.20 +
      parsed.criteria.platform_fit.score * 0.10
    )
    parsed.total_score = clamp(recomputed)

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
