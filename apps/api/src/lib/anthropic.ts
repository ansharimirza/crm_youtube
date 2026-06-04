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
    return JSON.parse(text.text) as ProductInfo
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
    return JSON.parse(text.text) as ProductInfo
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
    const parsed = JSON.parse(text.text) as { environments: string[] }
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
  script: string         // What happens in the scene (narrative)
  veo_prompt: string     // Technical prompt for Veo
}

const MODE_DESCRIPTIONS = {
  ugc: `UGC (User-Generated Content) — Casual, authentic style. Person on camera talking about the product. Like a real customer testimonial. Selfie-style or set up tripod. Natural lighting. Genuine reactions.`,
  pov_hand: `POV Hand Review — First-person perspective. Camera shows hands holding/using the product. No face. Close-up product interaction. Hands of various skin tones natural. Common for unboxing, demo, and ASMR-style content.`,
  mirror_check: `Mirror Check — Aesthetic mirror selfie. Person showcasing product (often wearable/fashion/beauty) in mirror reflection. Phone visible in shot. Effortless aesthetic vibe.`,
}

const CONTENT_TYPE_GUIDELINES = {
  review: `REVIEW (SUBTLE — DO NOT OVER-SELL):
- Tone: Relatable, casual, honest. "Aku udah pakai selama X minggu, ini jujur menurut aku..."
- Mention product naturally, not as selling pitch
- Balance: mention 1 con or honest observation, not just praise
- Avoid: "Kalian harus beli!", "Diskon hari ini!", "Link di bio!"
- The viewer should feel: "Oh, this is honest. I trust this person."`,

  unboxing: `UNBOXING (EXCITED DISCOVERY — DO NOT OVER-SELL):
- Tone: Genuine excitement about the packaging and reveal experience
- Focus: First impressions, packaging quality, surprise moments
- Energy: Curious and delighted, not promotional
- Avoid: Price discussions, "go buy now", overt CTA
- The viewer should feel: "I want to experience this unboxing too."`,

  affiliate: `AFFILIATE (CLEAR SELLING — PUSH HARD):
- Tone: Enthusiastic, confident, with clear value pitch
- Include: Key benefits, specific use case, price/discount mention
- CTA: Direct ("Link di bio!", "Cek keranjang kuning!", "Pakai kode...")
- Urgency: Time-limited offer, stock alert OK
- The viewer should feel: "I need to buy this now."`,
}

function buildSceneScriptSystem(mode: TiktokMode, contentType: ContentType, language: 'id' | 'en'): string {
  return `You are an expert TikTok content creator and short-form video director specializing in product content.

═══════════════════════════════════════════════════
MODE: ${mode.toUpperCase()}
${MODE_DESCRIPTIONS[mode]}

═══════════════════════════════════════════════════
CONTENT TYPE GUIDELINES
${CONTENT_TYPE_GUIDELINES[contentType]}

═══════════════════════════════════════════════════
LANGUAGE: ${language === 'id' ? 'Bahasa Indonesia (natural Gen-Z/millennial style, NOT formal corporate)' : 'English (casual, Gen-Z friendly)'}

═══════════════════════════════════════════════════
OUTPUT FORMAT:
Generate a complete scene-by-scene script. Each scene must have:

1. scene_number (integer)
2. duration (integer: 4, 6, or 8 seconds — match to scene complexity)
3. script: Narrative description of what happens in the scene in the requested LANGUAGE. Include camera angle, action, dialogue/voiceover if any.
4. veo_prompt: Technical English prompt for Google Veo to generate this scene. Include:
   - Subject and action
   - Camera angle (e.g., "close-up", "medium shot", "POV", "mirror reflection")
   - Lighting (warm, natural, studio)
   - Style (handheld iPhone style for UGC, smooth motion for affiliate)
   - Mood
   - End with: "Maintain consistency with provided product reference image."

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

  let raw = text.text.trim()
  // Strip optional markdown fences (Claude sometimes wraps despite "JSON ONLY")
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '')

  try {
    const parsed = JSON.parse(raw) as { scenes: SceneScript[] }
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
