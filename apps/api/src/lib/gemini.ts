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

// ===== RESUME PARSER =====

export interface ParsedResume {
  name: string
  contact: { phone: string; email: string; location: string; linkedin: string; website: string }
  summary: { tagline: string; bullets: string[]; skills: string[] }
  experience: Array<{
    title: string; company: string; location: string;
    start: string; end: string; summary: string; bullets: string[]
  }>
  education: Array<{
    degree: string; school: string; location: string; date: string; honors: string
  }>
  certifications: Array<{ name: string; org: string; date: string }>
  projects: Array<{ name: string; description: string; bullets: string[] }>
  awards: string[]
}

const RESUME_SCHEMA = {
  type: 'object',
  required: ['name', 'contact', 'summary', 'experience', 'education', 'certifications', 'projects', 'awards'],
  properties: {
    name: { type: 'string' },
    contact: {
      type: 'object',
      required: ['phone', 'email', 'location', 'linkedin', 'website'],
      properties: {
        phone: { type: 'string' },
        email: { type: 'string' },
        location: { type: 'string' },
        linkedin: { type: 'string' },
        website: { type: 'string' },
      },
    },
    summary: {
      type: 'object',
      required: ['tagline', 'bullets', 'skills'],
      properties: {
        tagline: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' } },
        skills: { type: 'array', items: { type: 'string' } },
      },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'company', 'location', 'start', 'end', 'summary', 'bullets'],
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          location: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          summary: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        required: ['degree', 'school', 'location', 'date', 'honors'],
        properties: {
          degree: { type: 'string' },
          school: { type: 'string' },
          location: { type: 'string' },
          date: { type: 'string' },
          honors: { type: 'string' },
        },
      },
    },
    certifications: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'org', 'date'],
        properties: {
          name: { type: 'string' },
          org: { type: 'string' },
          date: { type: 'string' },
        },
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description', 'bullets'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    awards: { type: 'array', items: { type: 'string' } },
  },
}

const RESUME_INSTRUCTION = `You are a resume parser. Extract structured data from the resume text below.

Rules:
- Return ALL fields. Use empty string "" or empty array [] for missing data.
- Do not invent content — only extract what's actually present.
- For "summary.tagline": one short italicized opening line like "Multi-faceted retail executive with expertise in:" (often appears right after contact info). If none, return "".
- For "summary.bullets": short summary bullet points.
- For "summary.skills": skill keywords (e.g. "Project Management", "P&L Ownership").
- For experience dates: format like "Jan 2022" or "2022" or "Present".
- Preserve the original language of the resume (don't translate).
- Order experience newest-first.

Resume text:
`

export async function parseResume(text: string, apiKey: string): Promise<ParsedResume> {
  const body = {
    contents: [
      {
        parts: [{ text: RESUME_INSTRUCTION + '\n\n' + text }],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: RESUME_SCHEMA,
      temperature: 0.1,
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
    throw new GeminiError(`Resume parse failed: ${errText}`, res.status)
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const txt = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!txt) throw new GeminiError('No text in Gemini response')

  return JSON.parse(txt) as ParsedResume
}

// ===== CAPTION & METADATA GENERATION =====

export interface CaptionResult {
  platform: Platform
  caption: string                    // TikTok/Reels: main caption. Shorts: short blurb
  title?: string                     // Shorts only
  description?: string               // Shorts only (full description)
  hashtags: string[]                 // semua platform
  tags?: string[]                    // Shorts only (keywords untuk YouTube SEO)
  cover_text?: string                // teks pendek untuk thumbnail/cover (3-7 kata)
  cta: string                        // call to action singkat
  alternative_captions: string[]     // 2 alternatif caption
}

const CAPTION_SCHEMA = {
  type: 'object',
  required: ['platform', 'caption', 'hashtags', 'cta', 'alternative_captions'],
  properties: {
    platform: { type: 'string', enum: ['tiktok', 'reels', 'shorts'] },
    caption: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    cover_text: { type: 'string' },
    cta: { type: 'string' },
    alternative_captions: { type: 'array', items: { type: 'string' } },
  },
}

function buildCaptionInstruction(
  platform: Platform,
  projectTitle: string,
  projectDescription: string | null,
  scenePrompts: string[],
  language: 'id' | 'en' = 'id',
): string {
  const langName = language === 'id' ? 'Bahasa Indonesia' : 'English'

  const platformGuide = platform === 'tiktok' ? `
PLATFORM: TIKTOK (data 2025-2026)
- caption: SUPER PENDEK. Target 3-10 kata. ATAU maksimal 50 karakter pesan utama (data: caption pendek = 112% lebih banyak comment).
  Pakai formula Hook-Question-CTA: bold claim + pertanyaan provokatif + ajakan singkat.
  Contoh BAGUS: "Aku gak nyangka ini terjadi... gimana menurutmu?"
  Contoh JELEK: "Hari ini aku mau cerita tentang pengalaman yang sangat berkesan untuk ku saat..."
- hashtags: TEPAT 3-5 hashtag niche-specific (jangan lebih). Mix 1 hashtag besar (#fyp / #foryoupage) + 2-3 niche spesifik + 1 branded jika ada. Hashtag tambahan = dilution algorithm.
- cover_text: WAJIB diisi. 3-7 kata SUPER pendek. Hook curiosity/bold claim/pertanyaan. Pakai CAPS LOCK kalau pas. Contoh: "RAHASIA KOK NEMU INI?" / "INI BOHONG ATAU GAK"
- cta: 1 kalimat singkat (follow / share / comment / save)
- title, description, tags: kosongkan (TIDAK PERLU)
` : platform === 'reels' ? `
PLATFORM: INSTAGRAM REELS (data Desember 2025-2026)
- caption: First 125 karakter PALING PENTING (yang visible sebelum tombol "more"). Total bisa sampai 2200 chars tapi jangan over-write. Target ideal: 100-200 karakter.
  Hook di kalimat pertama. Pakai 2-3 emoji.
- hashtags: MAX 5 HASHTAG (Instagram limit baru sejak Des 2025). Pilih 5 niche-spesifik > 30 broad. Mix: 1 trending (#reels #explore), 3-4 niche, 0-1 branded.
- cover_text: opsional 3-7 kata (kalau hook visual di cover)
- cta: 1-2 kalimat. "Save this!" / "Share ke teman" / "Comment kalau setuju". Save & share signal kuat ke algoritma Reels.
- title, description, tags: kosongkan (TIDAK PERLU)
` : `
PLATFORM: YOUTUBE SHORTS (data 2025-2026)
- title: WAJIB <40 karakter (truncate di mobile 45-50 chars). Pakai DECLARATIVE STATEMENT, BUKAN pertanyaan.
  RULES:
  • Echo hook line dari opening video (kalimat pertama di scene 1)
  • Front-load value di 45 chars pertama
  • Pakai NUMBERS kalau bisa (+20-30% CTR): "3 Tips...", "10 Detik...", "Cara #1..."
  • Power words ringan (Secret, Truth, Why, This, Never, Actually). Jangan over-hype.
  Contoh BAGUS: "3 Trik Atur Parfum Yang Awet Seharian" / "Aku Salah Pakai Parfum Selama 5 Tahun"
  Contoh JELEK: "Bagaimana cara menggunakan parfum dengan benar?" (pertanyaan) / "Tutorial parfum lengkap dari A sampai Z di video kali ini..." (over-length)
- description: WAJIB 300-500 karakter (detailed description = 35% lebih engagement). Format:
  Baris 1-2: Hook line + value statement
  Baris 3-4: Konteks singkat
  Baris 5: CTA (subscribe / watch next)
  Baris 6 (akhir): 3-5 hashtag, #Shorts WAJIB jadi yang PERTAMA
- caption: ringkasan 1 baris untuk snippet (sama dengan opening description)
- hashtags: TEPAT 3-5 hashtag. URUTAN PENTING: [#Shorts, #niche1, #niche2, #branded]. JANGAN lebih dari 15 atau SEMUA hashtag di-ignore YouTube.
- tags: WAJIB 8-15 keyword backend (TANPA tanda #, just keywords). Multi-layered: broad + niche + branded. Contoh: ["perfume tips", "fragrance guide", "parfum awet", "tutorial parfum", "kasih parfum", "BRAVEN", "cologne advice"]
- cover_text: 3-7 kata untuk text overlay di thumbnail. Hook + curiosity.
- cta: 1 kalimat ajakan subscribe untuk konten serupa.
`

  const scenesContext = scenePrompts.length > 0
    ? `\n\nKonteks video — terdiri dari ${scenePrompts.length} scene:\n${scenePrompts.map((p, i) => `Scene ${i+1}: ${p}`).join('\n')}`
    : '\n\n(Belum ada scene prompts.)'

  return `Kamu adalah AI copywriter ahli untuk short-form video viral.

Tugas: Buat caption + metadata untuk video yang akan di-publish.

PROJECT:
Title: "${projectTitle}"
${projectDescription ? `Description: ${projectDescription}` : ''}
${scenesContext}

${platformGuide}

LANGUAGE: Output semua text dalam ${langName} (kecuali hashtag yang umum dipakai dalam English).

ATURAN UMUM:
1. Caption HARUS punya hook di kalimat pertama (curiosity, bold claim, atau pertanyaan langsung)
2. Hashtag urut dari yang paling general → paling niche
3. Cover text WAJIB pendek (max 7 kata) dan high-impact
4. CTA jelas dan actionable
5. alternative_captions: 2 caption alternatif dengan angle berbeda (misal: 1 informatif, 1 emosional)
6. Jangan generic/AI-sounding. Tulis kayak creator beneran yang ngerti audience.`
}

export async function generateCaption(params: {
  apiKey: string
  platform: Platform
  projectTitle: string
  projectDescription?: string | null
  scenePrompts: string[]
  language?: 'id' | 'en'
}): Promise<CaptionResult> {
  const body = {
    contents: [
      {
        parts: [
          { text: buildCaptionInstruction(
              params.platform,
              params.projectTitle,
              params.projectDescription ?? null,
              params.scenePrompts,
              params.language ?? 'id',
            )
          },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: CAPTION_SCHEMA,
      temperature: 0.8,  // creative
    },
  }

  const res = await fetch(
    `${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${params.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new GeminiError(`Caption generation failed: ${errText}`, res.status)
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new GeminiError('No text in Gemini response')

  return JSON.parse(text) as CaptionResult
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

export interface ShortPick { start_sec: number; end_sec: number; title: string; reason: string }

const SHORT_PICK_SCHEMA = {
  type: 'object',
  properties: {
    start_sec: { type: 'number' },
    end_sec: { type: 'number' },
    title: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['start_sec', 'end_sec', 'title', 'reason'],
}

// Given a timed narration script (lines "[start-end] text" in seconds), pick the single
// best self-contained hook segment to cut into a vertical Short.
export async function pickShortSegment(timedScript: string, apiKey: string): Promise<ShortPick> {
  const instruction = `You are a viral short-form video editor. Below is a timed narration script of a long video; each line is "[start-end] text" in seconds.
Pick ONE contiguous segment that works as a standalone vertical Short (YouTube Shorts / TikTok):
- Must open with a strong hook in the first ~3 seconds; be self-contained; emotionally gripping or curiosity-driving.
- Duration between 20 and 55 seconds. Start and end on natural sentence/line boundaries from the script.
- Return start_sec and end_sec (numbers, taken from the script timings), a catchy title (<=80 chars, no quotes), and a one-line reason.

SCRIPT:
${timedScript}`

  const body = {
    contents: [{ parts: [{ text: instruction }] }],
    generationConfig: { response_mime_type: 'application/json', response_schema: SHORT_PICK_SCHEMA, temperature: 0.4 },
  }
  const res = await fetch(`${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new GeminiError(`Short pick failed: ${await res.text()}`, res.status)
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new GeminiError('No text in Gemini response for short pick')
  return JSON.parse(text) as ShortPick
}

export interface ClipPick { start_sec: number; end_sec: number; title: string; reason: string }

const CLIPS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      start_sec: { type: 'number' },
      end_sec: { type: 'number' },
      title: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['start_sec', 'end_sec', 'title', 'reason'],
  },
}

// Pick up to `count` clip-worthy segments from a timed transcript that satisfy a set of
// campaign REQUIREMENTS (rules that vary per campaign). Returns segments in seconds.
export async function pickClips(timedTranscript: string, requirements: string, count: number, apiKey: string): Promise<ClipPick[]> {
  const instruction = `You are a viral short-form video editor working on a paid clipping campaign.
Below is a timed transcript of a source video (each line "[start-end] text" in seconds) and the campaign REQUIREMENTS the clips MUST satisfy.

Pick up to ${count} of the BEST standalone vertical clips that each:
- Fully comply with the campaign requirements below (this is mandatory — reject anything that violates them).
- Open with a strong hook in the first ~3 seconds, are self-contained, and are emotionally gripping or curiosity-driving.
- Are between 15 and 60 seconds, starting and ending on natural sentence boundaries from the transcript.

Return a JSON array (max ${count} items). Each item: start_sec, end_sec (numbers from the transcript timings), a catchy title (<=80 chars, no quotes), and a one-line reason noting which requirement it satisfies.

=== CAMPAIGN REQUIREMENTS ===
${requirements || '(none specified — just pick the most viral moments)'}

=== TRANSCRIPT ===
${timedTranscript}`

  const body = {
    contents: [{ parts: [{ text: instruction }] }],
    generationConfig: { response_mime_type: 'application/json', response_schema: CLIPS_SCHEMA, temperature: 0.4 },
  }
  const res = await fetch(`${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new GeminiError(`Clip pick failed: ${await res.text()}`, res.status)
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new GeminiError('No text in Gemini response for clip pick')
  const arr = JSON.parse(text) as ClipPick[]
  return Array.isArray(arr) ? arr.slice(0, count) : []
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
