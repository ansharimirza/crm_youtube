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

const ENV_SUGGEST_SYSTEM = `You are a TikTok content production designer. Given a product, suggest 5 environment/backdrop options that would showcase the product effectively in a short-form video.

Each suggestion should be a concise 5-15 word description in the requested language. Output JSON ONLY:
{
  "environments": [
    "Environment description 1",
    "Environment description 2",
    "Environment description 3",
    "Environment description 4",
    "Environment description 5"
  ]
}

Mix realistic (home/store/cafe), aesthetic (minimalist studio, warm wood), and lifestyle (outdoor, gym) options based on what fits the product. Be specific about lighting and surface.`

export async function suggestEnvironments(
  productInfo: ProductInfo,
  language: 'id' | 'en',
  apiKey: string
): Promise<string[]> {
  const langInstr = language === 'id' ? 'Tulis dalam Bahasa Indonesia.' : 'Write in English.'
  const client = buildClient(apiKey)
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
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
    return parsed.environments.slice(0, 5)
  } catch (err) {
    throw new AnthropicError(`Failed to parse environment JSON: ${err instanceof Error ? err.message : err}`)
  }
}

/* ===========================================================
   4. SCENE SCRIPT GENERATION (the big one)
   =========================================================== */

export type TiktokMode = 'ugc' | 'pov_hand' | 'mirror_check'
export type ContentType = 'review' | 'unboxing' | 'affiliate'

export interface SceneScript {
  scene_number: number
  duration: number       // 4, 6, or 8 seconds
  script: string         // VO/narration text (what person says/thinks)
  image_prompt: string   // Static still-frame prompt for Nano Banana image gen
  veo_prompt: string     // Technical prompt for Veo motion/video generation
}

const MODE_DESCRIPTIONS = {
  ugc: `UGC (User-Generated Content) — Casual, authentic style. Person on camera talking about the product. Like a real customer testimonial. Selfie-style or set up tripod. Natural lighting. Genuine reactions.`,
  pov_hand: `POV Hand Review — First-person perspective. Camera shows hands holding/using the product. No face. Close-up product interaction. Hands of various skin tones natural. Common for unboxing, demo, and ASMR-style content.`,
  mirror_check: `Mirror Check — Aesthetic mirror selfie. Person showcasing product (often wearable/fashion/beauty) in mirror reflection. Phone visible in shot. Effortless aesthetic vibe.`,
}

const CONTENT_TYPE_GUIDELINES = {
  review: `REVIEW — Authentic peer-to-peer testimonial
FRAMEWORK: STEPPS (Practical Value + Social Currency + Stories) + Cialdini Liking principle

HOOK ANGLES that work for review (scene 1):
  - "Aku udah skeptis banget sama X, tapi..." (curiosity gap + commitment)
  - "Honest review setelah pake 2 minggu" (specific time = credibility)
  - "Ada yang minta review parfum ini, jadi gue test 30 hari" (mini-story)
  - "POV: kamu nyari parfum yang bukan musuh hidung" (relatable framing)

CORE MOVES (apply across scenes):
  - SPECIFIC time-based claim ("setelah X minggu pake, gue notice...")
  - Mention 1 honest LIMITATION or trade-off (builds trust)
  - Show product in REAL use context — bukan setup glamour
  - Reference daily routine touchpoint (work, gym, date — Triggers)
  - Implicit comparison vs alternatives WITHOUT naming competitors negatively

LANGUAGE — ID (Gen-Z natural, NOT formal):
  - Slang OK: "jujurly", "literally", "fr", "ngl", "real review", "spoiler", "PSA"
  - Filler: "tuh", "deh", "sih", "ya kan", "gini ya"
  - Avoid corporate: "Hadir!", "Memperkenalkan!", "Solusi terbaik!"

LANGUAGE — EN:
  - "ngl", "fr fr", "not gonna lie", "I'll be honest", "POV: you finally..."
  - "this slaps", "it's just it" (Gen-Z natural)

ANTI-PATTERNS (HARD RULES — jangan dilakukan):
  - JANGAN over-promise ("life-changing!", "best ever!", "wajib punya!")
  - JANGAN bahas harga atau diskon dalam scene (push ke caption/comments)
  - JANGAN "kalian harus beli" — let viewer decide
  - JANGAN ulang nama brand >3x (sounds like ad)
  - JANGAN testimonial pose tangan-di-pinggang influencer mode
  - JANGAN CTA langsung ("link di bio")

VIEWER FEEL: "Oh wait, this is a real person being honest. I should bookmark this."`,

  unboxing: `UNBOXING — Anticipation-driven sensory discovery
FRAMEWORK: STEPPS (Emotion: surprise/awe + Social Currency) + Zeigarnik effect (open-loop)

HOOK ANGLES (scene 1 — DELAY the reveal):
  - "Akhirnya dateng juga..." (anticipation, package not yet open)
  - "Coba tebak harga unboxing ini" (curiosity gap)
  - ASMR cold open: close-up sound of packaging tape, NO talking
  - "Yang ditunggu-tunggu dari [brand]" (social currency)

CORE MOVES:
  - DELAY reveal — build anticipation over 1-2 scenes before showing product
  - Sensory focus: packaging texture, weight, opening sound, paper rustle, foil shimmer
  - FIRST reaction must sound GENUINE — half-word pauses, micro-expressions
  - Close-up macro shots of premium touches (embossed logo, wax seal, ribbon)
  - Final scene: holding product up, soft satisfied smile (no hard sell)

LANGUAGE — ID (sensory + spontaneous):
  - "gila packaging-nya...", "berasa premium", "kayanya...", "wait sebentar"
  - "aroma-nya...", "soft banget", "heavy ya", micro-reactions "ohh", "wait apa nih"
  - "ditemenin..." breakdown moment

LANGUAGE — EN:
  - "the packaging tho", "okay this is luxurious", "wait what", "no but seriously"
  - "let me show you", "the way they..."

ANTI-PATTERNS:
  - JANGAN tunjukin produk di scene 1 (kill anticipation = kill engagement)
  - JANGAN bahas price, discount, atau "where to buy" (matiin magic)
  - JANGAN over-acting "WOWWW AMAZING" — sounds fake/scripted
  - JANGAN CTA explicit ("link di bio") — focus on experience aja
  - JANGAN review framing ("pros and cons") — wrong mode
  - JANGAN buka semuanya sekaligus — peel layers gradually

VIEWER FEEL: "I want to experience this exact moment. Saving for when my package comes."`,

  affiliate: `AFFILIATE — Conversion-focused with explicit CTA
FRAMEWORK: AIDA (Attention → Interest → Desire → Action) + Cialdini (Scarcity, Social Proof, Authority, Reciprocity)

HOOK ANGLES (lead with PROOF or BENEFIT, scene 1):
  - Social Proof: "Parfum yang sold out 3x di TikTok Shop"
  - Authority: "Yang udah dipake 50K+ orang di TikTok Shop"
  - Bold Benefit: "Parfum yang bikin cewek nyamperin lo duluan"
  - Scarcity: "Sebelum harganya naik 30% besok..."
  - Pattern: "Cowok yang mau di-notice, dengerin nih..."

CORE MOVES (AIDA flow across scenes):
  - Scene 1: ATTENTION — strong claim/proof/scarcity hook
  - Scene 2: INTEREST — single MOST important benefit (focus, not list)
  - Mid scenes: DESIRE — demo, result shot, before/after, transformation
  - Pre-final: SOCIAL PROOF — viral numbers, ratings, "yang udah cobain bilang..."
  - Final scene: ACTION — explicit CTA + urgency
  - Use specific NUMBERS (4.9 rating, 50K terjual, 12 hours left) — builds credibility

LANGUAGE — ID (TikTok Shop natural):
  - CTA: "cek keranjang kuning sekarang", "klik linknya di bio", "pakai kode XYZ"
  - Urgency: "stoknya tipis", "sebelum sold out lagi", "diskon cuma sampai..."
  - Hook starter: "PSA buat [target]", "kalo lo [persona], wajib tau ini"

LANGUAGE — EN:
  - CTA: "link in bio", "use code", "tap the yellow basket"
  - "running out fast", "trust me on this", "you NEED this"
  - "if you're in your [X] era..."

ANTI-PATTERNS:
  - JANGAN soft sell (defeats the purpose — be confident)
  - JANGAN multiple CTA — pilih SATU dominant action
  - JANGAN robotic feature listing — lead dengan WHY (emotion + benefit)
  - JANGAN exaggerate beyond believable ("makes you 10x more attractive!")
  - JANGAN delay CTA sampai end card — push within scenes
  - JANGAN flat tone throughout — energy harus naik menuju CTA

VIEWER FEEL: "Okay this person knows what they're talking about. Clicking now."`,
}

function buildSceneScriptSystem(mode: TiktokMode, contentType: ContentType, language: 'id' | 'en'): string {
  return `You are an expert TikTok content creator and short-form video director with deep research backing.

═══════════════════════════════════════════════════
RETENTION-CURVE STRUCTURE (TikTok algorithm rewards completion rate)
- Scene 1 (HOOK, 0-3s): Pattern interrupt. Strong claim, curiosity gap, visual shock, or direct question. NO greetings, NO setup, NO "hi guys".
- Scene 2 (CONTEXT, 3-8s): Why does this matter? Quick framing. Establish stakes or relatability.
- Mid scenes: Demonstration, proof, escalation, or twist. Maintain pacing — change angle or action every scene.
- FINAL scene: Payoff that loops back to the hook (review/unboxing) OR explicit CTA (affiliate). Leave viewer satisfied or activated.

═══════════════════════════════════════════════════
HOOK PATTERNS (use ONE in scene 1, choose based on content type):
- Bold Claim: assert something surprising as fact
- Curiosity Gap: hint at info viewer doesn't have yet
- Micro-Story: drop into a small narrative ("Kemarin di kantor...")
- Visual Shock: unexpected angle, reveal, or close-up
- Direct Question: "Kalian pernah ngerasa...?"
- Pattern Interrupt: start mid-action or mid-sentence
- Social Proof: lead with viral numbers or "yang udah cobain..."

═══════════════════════════════════════════════════
STEPPS PRINCIPLES (Jonah Berger — what makes content spread)
Target AT LEAST 2 hits across the full script:
- Social Currency: makes viewer feel smart/insider for knowing
- Triggers: connect product to daily-recurring context (morning routine, going out)
- Emotion: high-arousal feeling (awe, amusement, surprise) — NOT contentment
- Public: visibly used, branded, identifiable in shot
- Practical Value: specific tip or save-worthy info
- Stories: embedded in a mini-narrative arc

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
2. duration (integer: 4, 6, or 8 seconds — match to scene complexity)
3. script: VO / voiceover text in the requested LANGUAGE. This is what the person SAYS or thinks during the scene (1-2 sentences max). Natural conversational tone matching the content type. Do NOT include camera directions here — just spoken text.
4. image_prompt: Detailed English prompt for Nano Banana image generation. Describe the STILL FRAME (the starting picture of the scene). Must include:
   - Subject (person from reference image holding/using product from reference image)
   - Pose, expression, hands position
   - Camera angle (e.g., "selfie close-up", "POV looking down at hands", "mirror reflection waist-up")
   - Setting/environment details
   - Lighting (warm, natural, golden hour, studio softbox)
   - Style ("handheld iPhone photo, candid, slightly soft focus" for UGC; "clean product photography lighting" for affiliate)
   - 9:16 vertical composition cues
   - Must mention "using provided reference images for face and product consistency"
5. veo_prompt: Short English prompt for Veo to ANIMATE the still frame into 4-8s video. Describe only the MOTION (camera move, action, expression change, product interaction). Do NOT redescribe the subject — Veo will use the image as first frame. End with brief mood/lighting note.

═══════════════════════════════════════════════════
QUALITY CHECKS (run mentally before finalizing):
- Scene 1: does it pattern-interrupt within the first 5 words? If not, rewrite.
- Hook pattern: which one am I using? (Bold Claim / Curiosity Gap / Story / Visual Shock / Question / Social Proof)
- STEPPS: which 2+ principles does this script hit?
- Anti-patterns: have I avoided EVERY item in the content-type ANTI-PATTERNS list?
- Pacing: does each scene introduce something NEW (angle, action, or info)?
- Final scene: payoff or CTA matches the content type?

═══════════════════════════════════════════════════
CRITICAL RULES:
- Output JSON ONLY, no preamble, no markdown
- Schema:
{
  "scenes": [
    {
      "scene_number": 1,
      "duration": 4,
      "script": "...",
      "image_prompt": "...",
      "veo_prompt": "..."
    }
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
}): Promise<SceneScript[]> {
  const { apiKey, mode, contentType, language, productInfo, environment, sceneCount, aspectRatio } = params

  const system = buildSceneScriptSystem(mode, contentType, language)

  const client = buildClient(apiKey)
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Generate a ${sceneCount}-scene TikTok video script for this product:

PRODUCT:
Name: ${productInfo.name}
Category: ${productInfo.category}
Brand: ${productInfo.brand}
Description: ${productInfo.description}
Key Features: ${productInfo.key_features.join(', ')}

ENVIRONMENT: ${environment}

FORMAT: ${aspectRatio} aspect ratio (${aspectRatio === '9:16' ? 'vertical for TikTok/Reels/Shorts' : aspectRatio === '1:1' ? 'square' : 'horizontal'})

Generate exactly ${sceneCount} scenes that tell a cohesive story matching the mode and content type guidelines.`,
      },
    ],
  })

  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new AnthropicError('No text in response')

  try {
    const parsed = JSON.parse(stripJsonFences(text.text)) as { scenes: SceneScript[] }
    // Clamp duration to allowed values
    const allowed = [4, 6, 8] as const
    return parsed.scenes.slice(0, sceneCount).map((s, i) => {
      const d = Number(s.duration) || 4
      const duration = allowed.reduce((prev, curr) =>
        Math.abs(curr - d) < Math.abs(prev - d) ? curr : prev
      )
      return { ...s, scene_number: i + 1, duration }
    })
  } catch (err) {
    throw new AnthropicError(`Failed to parse scene JSON: ${err instanceof Error ? err.message : err}`)
  }
}
