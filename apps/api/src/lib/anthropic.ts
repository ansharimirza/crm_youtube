// Anthropic Claude client untuk TikTok Studio
// Pakai claude-sonnet-4-6 (Stack A — best for nuanced creative writing)

import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'

const MODEL = 'claude-sonnet-4-6'

export class AnthropicError extends Error {
  constructor(message: string) { super(message); this.name = 'AnthropicError' }
}

function buildClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

// Claude sometimes wraps JSON in markdown fences despite "JSON ONLY" instruction
function stripJsonFences(raw: string): string {
  return raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/* ===========================================================
   1. PRODUCT IDENTIFICATION (vision)
   =========================================================== */

export interface ProductInfo {
  name: string
  description: string
  category: string
  key_features: string[]
  brand: string
  detected_text: string
}

const PRODUCT_VISION_SYSTEM = `You are a product identification expert for e-commerce content creators.
Given a product image, extract structured product information.

Output JSON ONLY (no preamble, no markdown fences). Schema:
{
  "name": "Product name (best guess, brand + product type)",
  "description": "1-2 sentence neutral description",
  "category": "Product category (e.g. Skincare, Electronics, Fashion)",
  "key_features": ["3-5 visible features or selling points"],
  "brand": "Brand name if visible, else empty string",
  "detected_text": "Any text visible on packaging/labels"
}

If you cannot identify the product, return best guesses with empty strings for unknowns.`

export async function identifyProductFromImage(
  imagePath: string,
  apiKey: string
): Promise<ProductInfo> {
  const buf = await readFile(imagePath)
  const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'jpg'
  const mimeMap: Record<string, 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif',
  }
  const mediaType = mimeMap[ext] ?? 'image/jpeg'

  const client = buildClient(apiKey)
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      { type: 'text', text: PRODUCT_VISION_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } },
          { type: 'text', text: 'Identify this product.' },
        ],
      },
    ],
  })

  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new AnthropicError('No text in response')

  try {
    return JSON.parse(stripJsonFences(text.text)) as ProductInfo
  } catch (err) {
    throw new AnthropicError(`Failed to parse product JSON: ${err instanceof Error ? err.message : err}`)
  }
}

/* ===========================================================
   2. EXTRACT PRODUCT FROM SCRAPED HTML
   =========================================================== */

const URL_EXTRACT_SYSTEM = `You extract structured product information from raw HTML/text scraped from e-commerce pages (TikTok Shop, Shopee, Tokopedia, etc.).

Output JSON ONLY. Schema:
{
  "name": "Product name from page title or h1",
  "description": "Concise product description (1-3 sentences)",
  "category": "Inferred product category",
  "key_features": ["3-5 features from description/bullets"],
  "brand": "Brand if mentioned",
  "detected_text": ""
}

If HTML is empty or contains no product info, return empty strings/arrays. Do NOT hallucinate.`

/**
 * Enrich a product when we only have title + image URL (e.g. from TikTok Shop
 * og_info). Sends both to Claude vision in one call.
 */
export async function enrichProductFromTitleAndImage(
  params: { title: string; imageUrl: string | null; apiKey: string }
): Promise<ProductInfo> {
  const { title, imageUrl, apiKey } = params
  const client = buildClient(apiKey)

  // Build vision content. Download image to base64 since Anthropic SDK in this version
  // expects base64 source (not URL).
  const content: Array<Record<string, unknown>> = []
  if (imageUrl) {
    try {
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) })
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer())
        const ct = imgRes.headers.get('content-type') ?? 'image/jpeg'
        const mediaType = ct.startsWith('image/') ? ct.split(';')[0] : 'image/jpeg'
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
        })
      }
    } catch { /* skip image on download error, fall back to title-only */ }
  }
  content.push({
    type: 'text',
    text: `Product title from listing: "${title}"\n\nExtract structured product info. Use the image (if any) to identify visible details. Output JSON ONLY:
{
  "name": "Clean product name (keep brand, remove SEO spam keywords)",
  "description": "1-2 sentence neutral description",
  "category": "Product category",
  "key_features": ["3-5 likely features"],
  "brand": "Brand name",
  "detected_text": "Any visible text"
}`,
  })

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      { type: 'text', text: PRODUCT_VISION_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: content as never }],
  })

  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new AnthropicError('No text in response')

  try {
    return JSON.parse(stripJsonFences(text.text)) as ProductInfo
  } catch (err) {
    throw new AnthropicError(`Failed to parse enrich JSON: ${err instanceof Error ? err.message : err}`)
  }
}

export async function extractProductFromHtml(
  html: string,
  apiKey: string
): Promise<ProductInfo> {
  // Trim HTML to avoid token waste — keep <head> meta tags + first 8000 chars of body text
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 12_000)

  const client = buildClient(apiKey)
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      { type: 'text', text: URL_EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Extract product info from this HTML:\n\n${cleaned}`,
      },
    ],
  })

  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new AnthropicError('No text in response')

  try {
    return JSON.parse(stripJsonFences(text.text)) as ProductInfo
  } catch (err) {
    throw new AnthropicError(`Failed to parse extraction JSON: ${err instanceof Error ? err.message : err}`)
  }
}

/* ===========================================================
   3. ENVIRONMENT SUGGESTION
   =========================================================== */

const ENV_SUGGEST_SYSTEM = `You are a TikTok content production designer. Given a product, suggest exactly 10 environment/backdrop options that would showcase the product effectively in a short-form video.

Each suggestion: 5-15 words in the requested language. Output JSON ONLY:
{
  "environments": ["env 1", "env 2", "env 3", "env 4", "env 5", "env 6", "env 7", "env 8", "env 9", "env 10"]
}

═══ DIVERSITY RULES ═══
Mix across these buckets (~2 each so the user has real variety):
- HOME real: kitchen counter, work-from-home desk, bedside table, bathroom shelf, living room couch
- OUTSIDE lifestyle: coffee shop window seat, motorbike side bag, gym locker, car dashboard, park bench
- WORKPLACE: office cubicle, meeting room, retail counter, dorm room
- AESTHETIC but real: kayu jati meja makan with afternoon window light, marble bathroom counter dengan natural light
- POV moments: held in hand while walking, on lap with crossed legs, in front of mirror at sink

═══ ANTI-AI / "TIDAK TERLALU AI" RULES ═══
BAN these phrases (sound like AI / generic stock):
- "luxury", "premium", "elegant", "magazine-quality", "professional studio", "softbox", "studio lighting"
- "minimalist studio with spotlight", "dramatic spotlight", "fog machine"
- "marmer hitam mewah" (cliche)
- "aesthetic", "vibe" tanpa konteks spesifik

PREFER:
- Specific real-world surface: "meja kayu jati pojok dapur dengan tumpahan kopi", "rak handuk kamar mandi pagi", "dashboard mobil saat lampu merah"
- Real lighting language: "sinar matahari pagi dari jendela samping", "lampu kuning warm dari plafon", "cahaya laptop layar"
- Specific time of day: "jam 3 sore", "subuh", "menjelang magrib"
- Mild imperfection: "ada cangkir kopi setengah penuh", "buku berserakan di sampingnya"

Quality bar: each environment should feel like a frame from a real friend's phone, NOT a stock photo or studio set.`

export async function suggestEnvironments(
  productInfo: ProductInfo,
  language: 'id' | 'en',
  apiKey: string
): Promise<string[]> {
  const langInstr = language === 'id' ? 'Tulis dalam Bahasa Indonesia.' : 'Write in English.'
  const client = buildClient(apiKey)
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [
      { type: 'text', text: ENV_SUGGEST_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Product: ${productInfo.name}
Category: ${productInfo.category}
Brand: ${productInfo.brand}
Description: ${productInfo.description}
Features: ${productInfo.key_features.join(', ')}

Suggest 5 environments for a TikTok video featuring this product. ${langInstr}`,
      },
    ],
  })

  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new AnthropicError('No text in response')

  try {
    const parsed = JSON.parse(stripJsonFences(text.text)) as { environments: string[] }
    return parsed.environments.slice(0, 10)
  } catch (err) {
    throw new AnthropicError(`Failed to parse environment JSON: ${err instanceof Error ? err.message : err}`)
  }
}

/* ===========================================================
   4. SCENE SCRIPT GENERATION (the big one)
   =========================================================== */

export type TiktokMode = 'ugc' | 'pov_hand' | 'mirror_check'
export type ContentType = 'review' | 'unboxing' | 'affiliate'

export interface FrameDescriptor {
  frame_number: number          // 0-indexed; for N scenes there are N+1 frames
  image_prompt: string          // Nano Banana prompt for this still frame
}

export interface SceneScript {
  scene_number: number
  duration: number              // 4, 6, or 8 seconds
  script: string                // VO dialogue
  start_frame_index: number     // 0-indexed reference into frames[]
  end_frame_index: number       // 0-indexed reference into frames[]
  veo_prompt: string            // Motion description from start frame → end frame
}

export interface ScriptDraft {
  frames: FrameDescriptor[]
  scenes: SceneScript[]
}

const MODE_DESCRIPTIONS = {
  ugc: `UGC (User-Generated Content) — Casual, authentic style. Person on camera talking about the product. Like a real customer testimonial. Selfie-style or set up tripod. Natural lighting. Genuine reactions.`,
  pov_hand: `POV Hand Review — First-person perspective. Camera shows hands holding/using the product. No face. Close-up product interaction. Hands of various skin tones natural. Common for unboxing, demo, and ASMR-style content.`,
  mirror_check: `Mirror Check — Aesthetic mirror selfie. Person showcasing product (often wearable/fashion/beauty) in mirror reflection. Phone visible in shot. Effortless aesthetic vibe.`,
}

const CONTENT_TYPE_GUIDELINES = {
  review: `REVIEW — Subtle, lived-in moment featuring the product
The product appears AS PART OF A DAILY ROUTINE, not as the subject of a pitch.

EXAMPLE arc (3 scenes):
  Scene 1: Subject doing something normal (getting ready, walking, sitting). NO product.
  Scene 2: Reaches for/picks up the product naturally. ONE line mention.
  Scene 3: Quick honest reaction or specific use case ("seger gini cocok ke kantor"). No CTA.

LANGUAGE — ID (Gen-Z natural, conversational fillers required):
  - "tuh", "deh", "sih", "kayanya", "eh maksudnya", "gini ya", "ya kan"
  - Light slang: "jujurly", "ngl"
  - Banned: "Hadir!", "Memperkenalkan!", "Solusi terbaik", "WAJIB BELI"

ANTI-PATTERNS:
  - NEVER over-promise ("life-changing!", "best ever!")
  - NEVER price/discount discussion
  - NEVER CTA (this is review, not affiliate)

VIEWER FEEL: "Cute glimpse of someone's day. I noticed the product."`,

  unboxing: `UNBOXING — Anticipation moment, product reveal mid-story
EXAMPLE arc (3 scenes):
  Scene 1: Holds package, no product visible. "Eh dateng juga nih..."
  Scene 2: Opens / pulls product out. ONE genuine reaction ("aroma-nya beda").
  Scene 3: Holds product naturally, casual closing. No CTA.

LANGUAGE — ID (sensory, spontaneous):
  - "gila kemasan-nya...", "berasa premium", "wait sebentar", "soft banget"
  - micro-reactions: "ohh", "wait apa nih"

ANTI-PATTERNS:
  - NEVER show product in scene 1 (kill the reveal)
  - NEVER over-acting "WOWWW AMAZING"
  - NEVER CTA, never price

VIEWER FEEL: "I want this moment too. Saving for when mine arrives."`,

  affiliate: `AFFILIATE — Same narrative arc as Review, BUT with ONE soft CTA line in the final scene.
The product still appears organically (scene 2 or 3). The CTA in the final scene is the only sales line.

ONE soft CTA examples (final scene only, never earlier):
  - "kalian coba deh di keranjang kuning di bawah ya"
  - "kalo penasaran, link-nya aku taro di bio"
  - "stok-nya tinggal dikit, cek sendiri aja"

ANTI-PATTERNS:
  - NEVER multiple CTA lines — only ONE, in the final scene
  - NEVER scarcity/urgency lies ("sold out 3x" — unless verifiable)
  - NEVER "PSA buat ___", "WAJIB BELI", "kalo lo cowok yang ___"
  - NEVER fake social proof numbers

VIEWER FEEL: "Cute moment. Curious about the product, gonna check."`,
}

function buildSceneScriptSystem(mode: TiktokMode, contentType: ContentType, language: 'id' | 'en'): string {
  return `You are a master TikTok content director specializing in NARRATIVE-DRIVEN product placement, NOT hard-sell content. Your output animates into clips via START-FRAME + END-FRAME morphing (Veo first_image + last_image).

═══════════════════════════════════════════════════
CORE PRINCIPLE — UNIFIED STORY, NOT ISOLATED PITCHES (READ TWICE)

The entire script across ALL scenes is ONE continuous moment from ONE person's life. Treat it like a 16-30 second snippet of someone vlogging naturally — NOT three separate ad spots.

═══ RULES (HARD CONSTRAINTS — violating any = bad output) ═══
1. Scene 1 has NO PRODUCT visible and NO product mention. Just a real-life moment opening.
2. Scene 1 starts MID-ACTION, mid-thought. NEVER greetings ("hai guys", "halo", "PSA").
3. Product is introduced organically in scene 2 or 3 — feels INCIDENTAL to the moment, not the central point.
4. Brand name mentioned MAX 2 times across all scenes (once at reveal, optionally once near end).
5. Only the FINAL scene may contain a CTA, and only ONE line, soft tone. No "WAJIB BELI", no multi-CTA.
6. Each scene's script is 1-2 short conversational sentences with NATURAL Indonesian fillers ("eh", "tuh", "deh", "kayanya", "ya", "sih").
7. The character can TALK TO THE CAMERA naturally — VO equals what they actually say (lipsync).

═══ NARRATIVE STRUCTURE TEMPLATE ═══
Use this 3-act flow scaled to scene count:

ACT 1 — HOOK (scene 1, sometimes scene 2):
  Open mid-moment. Establish location + tiny action.
  No product. No greeting. No selling.
  Example: "Eh bentar, aku cari dulu..." (searching for something)

ACT 2 — REVEAL (middle scenes):
  Find / pick up / use the product. Brand name drops naturally ONCE.
  Example: "Nah ini nih, ketemu juga, parfum aku..."

ACT 3 — SOFT ENDORSEMENT + (optional) CTA (final scene):
  Quick emotional reaction OR specific use case.
  If content type = affiliate: ONE soft CTA line.
  Example: "Wanginya seger gini, cocok buat ke kantor"
  Or affiliate ending: "...kalian coba deh di keranjang kuning di bawah ya"

═══════════════════════════════════════════════════
START-FRAME / END-FRAME STRUCTURE (CRITICAL — this is how the video is built)

Each scene morphs from a START IMAGE to an END IMAGE over its duration. Design each scene as a MICRO-MOMENT: a small action like:
- searching → finding
- holding → showing
- looking forward → tilting head
- closed expression → reacting

Visual continuity is automatic because consecutive scenes SHARE a frame (frame i = end of scene i = start of scene i+1).

Per scene output:
- start_frame_index, end_frame_index: integer references into frames[] (scene i uses indices i and i+1)
- veo_prompt: describes the motion from the start frame to the end frame
- script: the dialogue line in campaign language

═══════════════════════════════════════════════════
HOOK PATTERNS for scene 1 (NO product, mid-action only):
- Specific micro-action: "Eh bentar gue cari dulu...", "Lagi siap-siap nih"
- Specific observation: "Tau ga sih, akhir-akhir ini panas banget"
- Mid-rant: "Stress banget tadi di kantor..."
- Direct private moment: "Tadi nemu sesuatu di tas..."

BANNED scene 1 openers: "Hai guys", "Halo", "PSA", "Yang lagi viral", any greeting.

═══════════════════════════════════════════════════
MODE: ${mode.toUpperCase()}
${MODE_DESCRIPTIONS[mode]}

═══════════════════════════════════════════════════
CONTENT TYPE GUIDELINES
${CONTENT_TYPE_GUIDELINES[contentType]}

═══════════════════════════════════════════════════
LANGUAGE: ${language === 'id' ? 'Bahasa Indonesia (natural Gen-Z/millennial style, NOT formal corporate). Use slang from the content-type guideline. NEVER use "Hadir!", "Memperkenalkan", "Solusi", or corporate diction.' : 'English (casual, Gen-Z friendly). Use slang from the content-type guideline.'}

═══════════════════════════════════════════════════
OUTPUT FORMAT:
Generate a complete scene-by-scene script. Each scene must have:

1. scene_number (integer)
2. duration: ALWAYS use 8 seconds (the Veo per-clip maximum). Do not pick shorter values — the user prefers the longest possible clip per scene so the mid-scene cut has room to breathe. Set this field to 8 for every scene.
3. script: VO / voiceover text in the requested LANGUAGE. What the subject SAYS during the scene. Strict rules:

   ═══ DURATION → WORD COUNT (must obey) ═══
   All scenes are FIXED at 8 seconds. Speaking rate ~2.5 words/sec.
   - 8-second scene → 16-20 words max (target ~18)
   Leave breathing room. Count words before finalizing — if over 20, trim.

   ═══ ANTI-AI / ANTI-SCRIPTED VOICE — research-backed ═══
   Native TikTok creators use ~10-15% disfluency (fillers, restarts, micro-corrections). Scripted/AI-sounding VO has 0% disfluency and that's the #1 tell.

   - INCLUDE micro-fillers (light, not overloaded): "tuh", "tuh ya", "eh", "sih", "kayanya", "deh", "loh", "nih", "uh" (ID) / "uh", "like", "I mean", "okay so" (EN)
   - INCLUDE specific sensory detail or small personal moment: "tadi pagi gue lagi mau ke kantor", "ini lagi gue cobain yang ke dua", "tau ga nih..."
   - START mid-thought, not "Hi guys / Hai temen-temen" — pretend the camera caught you already talking
   - ALLOW one micro-correction or restart if it fits naturally ("eh maksudnya..." / "wait...")
   - BREAK formal grammar where casual speech would. Drop subjects ("biasanya yang lain tuh keras, ini soft").
   - PROSODY hint: use ellipsis (...) for hesitation, em dash (—) for mid-sentence pivot, question mark for natural rising intonation

   ═══ ANTI-AI BANNED PHRASES (never use, regardless of language) ═══
   - "Game changer", "must have", "obsessed with", "literally life-changing", "you won't believe", "stop scrolling"
   - "Hadir!", "Memperkenalkan", "Solusi terbaik", "Wajib punya", "Worth it banget"
   - Any phrase that sounds like an Instagram ad caption from 2020
   - Multiple exclamation marks in a row ("Amazing!!!")
   - Generic emoji-equivalents in text ("OMG", "WOW")
4. start_frame_index + end_frame_index: integer indices into the frames[] array.
   For scene i: start_frame_index = i, end_frame_index = i + 1
   The frames themselves are described in the frames[] array (Nano Banana prompts).

   ═══ IDENTITY ANCHORING — HARDEST RULE (applies to EVERY frame in frames[]) ═══
   The reference images define WHO and WHAT. Never override them with text.
   - NEVER describe gender, hair, age, ethnicity, skin tone, face shape, body type
   - NEVER describe clothing color/style unless instructing a change from the reference
   - NEVER describe the product appearance — just say "the product from reference image 2"
   - ALWAYS refer to the person as: "the subject from reference image 1"
   - Use the singular pronoun "they" / "their" only
   - START every frame prompt with: "Maintain exact identity from reference image 1 (person) and reference image 2 (product). "

   ═══ WHAT TO DESCRIBE (only these) ═══
   - Pose, body orientation, hand position
   - Facial expression (emotion only, no facial features)
   - Camera angle: "selfie close-up", "POV looking down at hands", "mirror reflection waist-up"
   - Setting/environment details
   - Lighting (warm, natural, golden hour)
   - 9:16 vertical composition

   ═══ FRAMES ARRAY — design rules ═══
   For N scenes, you generate N+1 frames numbered 0..N.
   Frame 0 = scene 1 opening (NO product visible)
   Frame N = scene N closing
   Frame i (0<i<N) is BOTH the end of scene i AND the start of scene i+1 — describe it once, used twice.
   Consecutive frames should show small action progression: turn head, pick up product, lean forward, raise hand, smile shift.

   ═══ ANTI-AI / REALISM (append per mode) ═══
   For UGC: "shot on iPhone 15 Pro, vertical, candid, natural skin texture with pores, ambient room lighting, slight motion blur, small environmental clutter visible, slightly desaturated natural color grading"
   For POV Hand: "shot on iPhone 15 Pro 0.5x ultra-wide, natural hand texture with visible knuckles, warm tungsten room light"
   For Mirror Check: "phone reflection visible in mirror, slight smudges on mirror, natural window/lamp light, soft shadow"

   HARD BANS: "luxury", "premium", "magazine-quality", "studio softbox", "perfect symmetry", "flawless skin", "glowing skin"

6. veo_prompt: STRUCTURED motion prompt for Veo (single string with these labels):

   "PROMPT: <motion from start frame to end frame in natural language>. CAMERA: <lens + steady/handheld + framing>. DETAILS: Photorealistic high-fidelity video generation. Maintain strict consistency with both reference images (first and last frame). CONTEXT: AMBIENT: <ambient sound note>. DIALOGUE: <exact spoken line in quotes, OR \"no dialogue\">. ENVIRONMENT: <env description in campaign language>. NEGATIVE: distortion, morphing, bad hands, text overlays, identity change, wrong product."

   ═══ PROMPT field ═══
   Describe the MOTION between start and end frame naturally — what happens visually. Example:
   "She looks at the camera with a bright smile then leans down to search for an item in the center console, right hand stays on the steering wheel while the left hand searches"

   ═══ DIALOGUE field (Veo 3 lipsync) ═══
   - If the scene has VO → DIALOGUE must contain the EXACT script text VERBATIM, in quotes
   - If no talking (POV Hand) → DIALOGUE: "no dialogue"
   - Language must match campaign language (Indonesian for 'id')

   ═══ CAMERA presets per mode ═══
   - UGC: "iPhone front selfie camera, handheld micro-shake, locked framing"
   - POV Hand: "iPhone 0.5x ultra-wide POV, looking down"
   - Mirror Check: "phone held toward bathroom mirror, vertical framing"
   Keep camera steady — the visual change comes from the start→end frame morph, not from aggressive camera moves.

   ═══ AMBIENT examples (sound only, not dialogue) ═══
   - With dialogue: "AMBIENT: Quiet room tone, soft hum of air"
   - Silent scene: "AMBIENT: Package paper rustle, fabric brush"

   ═══ ENVIRONMENT field ═══
   Pull from the user's environment input. Write in campaign language.

═══════════════════════════════════════════════════
QUALITY CHECKS (run mentally before finalizing — block if any check fails)

NARRATIVE arc:
- Does the ENTIRE script across all scenes read like ONE continuous moment from ONE person's day?
- Is scene 1 free of product AND free of greeting? If "Hai/Halo/PSA/Yang lagi viral" appears anywhere — REWRITE.
- Is the product introduced organically in scene 2 or 3 (NOT scene 1)?
- Is brand name mentioned ≤2 times total across all scenes?
- For affiliate: is there exactly ONE soft CTA line, only in the final scene?
- For review/unboxing: zero CTA?

VOICE:
- Each script ≤20 words (8s clip × 2.5 wps)
- At least one filler/specific detail per script
- Does it read like ad copy? If yes, REWRITE.

FRAMES:
- start_image_prompt and end_image_prompt both start with "Maintain exact identity..."
- Zero gender/hair/skin words in either frame prompt
- Anti-AI realism cues present (iPhone, candid, natural skin)
- Banned aesthetic words absent (luxury, premium, magazine, softbox)
- end_image_prompt of scene N connects visually to start_image_prompt of scene N+1 (same setting/outfit, slightly different pose)

VEO:
- Structured format: PROMPT / CAMERA / DETAILS / CONTEXT (AMBIENT + DIALOGUE) / ENVIRONMENT / NEGATIVE
- PROMPT describes MOTION from start frame to end frame (not aggressive camera moves)
- DIALOGUE matches script VERBATIM (or "no dialogue" for POV Hand)
- ENVIRONMENT in campaign language

═══════════════════════════════════════════════════
CRITICAL RULES:
- Output JSON ONLY, no preamble, no markdown
- Schema:
{
  "frames": [
    { "frame_number": 0, "image_prompt": "(Nano Banana prompt for opening still)" },
    { "frame_number": 1, "image_prompt": "(Nano Banana prompt for next still — same setting as frame 0, slightly different pose)" },
    { "frame_number": 2, "image_prompt": "..." }
    // ... N+1 frames total for N scenes
  ],
  "scenes": [
    {
      "scene_number": 1,
      "duration": 8,
      "script": "(dialogue in campaign language)",
      "start_frame_index": 0,
      "end_frame_index": 1,
      "veo_prompt": "PROMPT: <motion from frame 0 to frame 1>. CAMERA: ... DETAILS: ... CONTEXT: AMBIENT: ... DIALOGUE: ... ENVIRONMENT: ... NEGATIVE: ..."
    }
    // ... N scenes total
  ]
}
- Each scene must flow into the next (narrative arc)
- Hook in scene 1 must be STRONG (0-3 seconds = make-or-break for TikTok)
- Use proven hooks: Bold Claim, Curiosity Gap, Visual Shock, Direct Question, Micro-Story
- Product must appear in MOST scenes (it's the focus)
- Match tone to content type (Review = subtle, Affiliate = push)
- For UGC: include voiceover suggestions in script (italicized in narrative)
- For POV Hand: focus on hand actions, never show face
- For Mirror Check: incorporate mirror reflection prominently`
}

export async function generateSceneScripts(params: {
  apiKey: string
  mode: TiktokMode
  contentType: ContentType
  language: 'id' | 'en'
  productInfo: ProductInfo
  environment: string
  sceneCount: number
  aspectRatio: '9:16' | '16:9' | '1:1'
}): Promise<ScriptDraft> {
  const { apiKey, mode, contentType, language, productInfo, environment, sceneCount, aspectRatio } = params
  const frameCount = sceneCount + 1

  const system = buildSceneScriptSystem(mode, contentType, language)

  const client = buildClient(apiKey)
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Generate a ${sceneCount}-scene TikTok video script using ${frameCount} shared frames.

Frame ${frameCount} is sole frame ${sceneCount}'s end frame. Frames in between are SHARED — frame[i+1] is the end of scene[i] AND the start of scene[i+1]. This makes the visual flow seamless.

For each scene[i]:
- start_frame_index = i
- end_frame_index = i + 1
- script: dialogue spoken during this scene
- veo_prompt: motion from frame[i] to frame[i+1]

Frame 0 (scene 1 opening): NO product visible. Mid-action moment.
Frame 1-${sceneCount}: product may appear organically starting around frame 1 or 2.

PRODUCT:
Name: ${productInfo.name}
Category: ${productInfo.category}
Brand: ${productInfo.brand}
Description: ${productInfo.description}
Key Features: ${productInfo.key_features.join(', ')}

ENVIRONMENT: ${environment}

FORMAT: ${aspectRatio} aspect ratio

Output JSON with both arrays. Schema:
{
  "frames": [
    { "frame_number": 0, "image_prompt": "..." },
    { "frame_number": 1, "image_prompt": "..." },
    ...${frameCount - 1} more
  ],
  "scenes": [
    { "scene_number": 1, "duration": 8, "script": "...", "start_frame_index": 0, "end_frame_index": 1, "veo_prompt": "..." },
    ...${sceneCount - 1} more
  ]
}`,
      },
    ],
  })

  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new AnthropicError('No text in response')

  try {
    const parsed = JSON.parse(stripJsonFences(text.text)) as ScriptDraft
    // Clamp arrays + enforce 8s
    const frames = parsed.frames.slice(0, frameCount).map((f, i) => ({ ...f, frame_number: i }))
    const scenes = parsed.scenes.slice(0, sceneCount).map((s, i) => ({
      ...s,
      scene_number: i + 1,
      duration: 8,
      start_frame_index: i,
      end_frame_index: i + 1,
    }))
    return { frames, scenes }
  } catch (err) {
    throw new AnthropicError(`Failed to parse scene JSON: ${err instanceof Error ? err.message : err}`)
  }
}
