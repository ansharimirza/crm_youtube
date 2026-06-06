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
HOOK PATTERNS (scene 1 ONLY — 0-3s = make-or-break)

Native-feeling hooks share one trait: they sound like the start of a thought, NOT the start of an ad. Research from TikTok creator studies (2023-2025):
- Top-quartile hooks open with a SPECIFIC, concrete detail OR a mid-thought sentence
- Bottom-quartile hooks open with a generic call-to-attention ("Stop scrolling!", "Hey guys!")

Choose ONE pattern that fits the content type:

- Specific Story Drop: open with one concrete sentence from a moment.
   ✓ "Kemarin di lift kantor, ada cowok nyamperin gue cuma buat nanya parfum gue apa..."
   ✗ "Hai guys, hari ini aku mau review parfum..." (generic, AI-tell)

- Curiosity Gap: imply info viewer doesn't have.
   ✓ "Parfum yang dipake cowok-cowok yang biasanya disangka mahal padahal..."
   ✗ "Kalian harus tau parfum ini!" (telling, not showing)

- Bold Specific Claim: a concrete claim with a specific number, comparison, or contrast.
   ✓ "30 hari pake parfum ini, ke-3 orang dari empat orang yang gue temuin nanya wanginya apa"
   ✗ "Parfum terbaik yang pernah aku coba!" (vague, generic)

- Pattern Interrupt: start mid-action or mid-sentence as if camera caught you talking.
   ✓ "...nih dia masalahnya kalo pake parfum yang salah..."
   ✗ "Halo semua! Selamat datang!" (literal opposite)

- Direct Question (only when SPECIFIC):
   ✓ "Kalian pernah ga ke gym terus baju kalian bau parfum kalian sendiri sampe pulang?"
   ✗ "Pernah ga sih kalian pengen wangi enak?" (vague)

═══ ANTI-AI HOOK BANS (never open scene 1 with these) ═══
- "Stop scrolling!", "Hai guys", "Halo semua", "Hi everyone", "Hari ini aku mau"
- "PSA" (overused, screams AI)
- "Yang lagi viral", "Yang lagi trending"
- "Diskon hari ini" (sales-y opener)
- "Kalian harus", "You need to", "You won't believe"
- Any greeting whatsoever

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
4. image_prompt: Detailed English prompt for Nano Banana image generation. Describe the STILL FRAME (the starting picture of the scene).

   ═══ IDENTITY ANCHORING — HARDEST RULE ═══
   The reference images define WHO and WHAT. Never override them with text.
   - NEVER describe gender ("a woman", "a man", "she", "he", "a young female")
   - NEVER describe hair (color, length, style)
   - NEVER describe age, ethnicity, skin tone, face shape, body type
   - NEVER describe clothing color/style unless instructing a change from the reference
   - NEVER describe the product appearance (label, color, shape) — just say "the product from reference image 2"
   - ALWAYS refer to the person as: "the subject from reference image 1" or "the person from reference image 1"
   - Use the singular pronoun "they" / "their" only — never "she/her/he/his"
   - START every image_prompt with: "Maintain exact identity from reference image 1 (person) and reference image 2 (product). "

   ═══ WHAT TO DESCRIBE (only these) ═══
   - Pose, body orientation, hand position (without describing the hands themselves)
   - Facial expression (smile, surprised, focused, intrigued) — emotion only, no facial features
   - Camera angle: "selfie close-up", "POV looking down at hands", "mirror reflection waist-up", "medium shot from below"
   - Setting/environment details (props, surface, backdrop)
   - Lighting (warm, natural, golden hour, studio softbox)
   - Photography style: "handheld iPhone photo, candid, slightly soft focus" for UGC; "clean product photography lighting" for affiliate
   - 9:16 vertical composition cues
   - End with: "Photorealistic, maintain strict consistency with both provided reference images."

   ═══ ANTI-AI / "NOT TOO AI" IMAGE DIRECTIVES — research-backed ═══
   AI-image tells: glossy plastic skin, perfect symmetry, over-lit studio look, zero clutter, hyper-saturated colors, stock-photo composition. We want it to feel like a phone photo a friend took.

   For UGC mode, ALWAYS append these realism cues:
   - "shot on iPhone 15 Pro, vertical, candid, slight motion blur from hand-hold"
   - "natural skin texture with pores and slight imperfections — not glossy or smoothed"
   - "ambient room lighting with subtle color cast (not studio softbox)"
   - "slight imperfections in framing — composition feels casual, not perfect rule of thirds"
   - "small environmental clutter visible (papers on table, cable, etc) — lived-in space, not pristine"
   - "color grading: natural, slightly desaturated, slight green/yellow cast like phone camera in indoor light"

   For POV Hand mode, ALWAYS append:
   - "shot on iPhone 15 Pro 0.5x ultra-wide, slight handheld micro-shake"
   - "natural hand texture — visible knuckles, faint veins, not airbrushed"
   - "warm tungsten room light, NOT studio softbox"

   For Mirror Check mode, ALWAYS append:
   - "phone screen reflection visible in mirror, slight smudges on mirror surface"
   - "natural room lighting from window/lamp, soft shadow under chin"

   ═══ HARD BANS ═══
   - Banned aesthetic words: "luxury", "premium", "magazine-quality", "professional photoshoot", "studio softbox", "fashion editorial", "cinematic" (use for AFFILIATE Veo prompt context only)
   - Banned composition: "perfect symmetry", "rule of thirds", "golden ratio"
   - Banned skin: "flawless", "porcelain", "glowing", "smooth"
5. veo_prompt: STRUCTURED motion prompt for Veo. Use EXACTLY this label format, one line per label (no line breaks within a label). All labels in UPPERCASE. Output it as a SINGLE STRING with " " separating each label section.

   Required structure:
   "PROMPT: <action summary>. CAMERA: <lens + angle + camera motion>. DETAILS: Photorealistic high-fidelity video generation. Maintain strict consistency with the provided image reference. CONTEXT: AMBIENT: <ambient sound note>. DIALOGUE: <exact spoken line in quotes, OR \"no dialogue\">. ENVIRONMENT: <env description in campaign language>. NEGATIVE: distortion, morphing, bad hands, text overlays, identity change, wrong product."

   ═══ DIALOGUE FIELD (critical for Veo 3 lipsync) ═══
   - If the scene HAS voiceover (UGC, Mirror Check with talking) → DIALOGUE must contain the EXACT same text as the script field, in quotes. Example: DIALOGUE: "Tuh kan, gue baru sadar parfum gue beda banget"
   - The DIALOGUE text MUST match script field VERBATIM (same words, same punctuation)
   - If POV Hand mode (no face, no talking) → DIALOGUE: "no dialogue"
   - If a UGC scene is intentionally silent (eg. visual reaction beat) → DIALOGUE: "no dialogue", and AMBIENT: should describe the sound
   - The DIALOGUE language must be the CAMPAIGN language (Indonesian for 'id'); do NOT translate to English

   ═══ MID-SCENE CUT RULE (CRITICAL — must feel like a visible edit) ═══
   Each Veo clip is 4-8s. You MUST design PROMPT as TWO BEATS with an OBVIOUS visual shift at the midpoint — same character, same setting, no scene change, but the framing/scale must CLEARLY change. Subtle gaze shifts do NOT count. The viewer should perceive it like a hard cut, even though Veo treats it as one shot.

   Pick ONE pattern for beat 2 (visible shift):
   - SNAP ZOOM-IN: camera rapidly pushes from medium shot to extreme close-up on a detail (label, hand, lips, eye)
   - SNAP ZOOM-OUT: camera quickly pulls from close-up to wide reveal of full body or room
   - ANGLE CUT: camera position changes — e.g. front-on to overhead, eye-level to low-angle, selfie to over-the-shoulder
   - SMASH CUT TO DETAIL: hold the establishing shot, then jump-cut to ultra-close on one product element
   - SPEED RAMP: action accelerates dramatically at midpoint (slow → fast unwrapping)

   Beat 1 (0 → half duration): Frame opens matching the still image. Hold the establishing pose ~1s.
   Beat 2 (half duration → end): EXPLICIT visual change using one of the patterns above. Phrase it as a DIRECTIVE, not a suggestion:
   ✓ "At the 4-second mark, HARD SNAP ZOOM to extreme close-up of the product label, filling the frame."
   ✓ "At the 2-second mark, ANGLE CUT to overhead top-down shot of hands holding the box."
   ✗ "At the midpoint, their gaze lifts slightly" — too subtle, REWRITE.

   For 4-second clips → shift at 2s. For 8-second clips → shift at 4s.

   ═══ CAMERA field — describe BOTH the opening lens AND the cut transition ═══
   Format: "<opening lens/angle>, <transition keyword> at <timestamp>"
   Examples per mode:
   - UGC: "iPhone front selfie camera, handheld micro-shake, SNAP ZOOM-IN to extreme close-up of mouth/lips at the 4-second mark"
   - POV Hand: "iPhone 0.5x ultra-wide lens, looking down at the hands and surface, ANGLE CUT to overhead top-down at the 4-second mark"
   - Mirror Check: "Phone held in front of mirror, vertical framing, SNAP ZOOM-OUT to full mirror reveal at the 2-second mark"

   ═══ AMBIENT examples (sound only, not what is said) ═══
   - With dialogue: "AMBIENT: Quiet room tone with light keyboard typing in the background"
   - Without dialogue (POV Hand): "AMBIENT: Mouth closed or natural breathing, no talking. Package paper rustle, fabric brush against table"
   - Mirror Check pause: "AMBIENT: Soft bathroom acoustic, faint water drip"
   - General: describe physical room sounds, NOT speech (speech goes in DIALOGUE)

   ═══ ENVIRONMENT field ═══
   Write in the campaign's language (Bahasa Indonesia for 'id', English for 'en'). Pull from the user's environment input verbatim or paraphrase tightly.

═══════════════════════════════════════════════════
QUALITY CHECKS (run mentally before finalizing — block if any check fails)
- Scene 1 hook: does it START mid-thought OR with a specific concrete detail? No greeting allowed. If you wrote "Hai", "Halo", "Hi", "PSA", or "Yang lagi viral" — REWRITE.
- Hook pattern: which one am I using? (Specific Story Drop / Curiosity Gap / Bold Specific Claim / Pattern Interrupt / Direct Specific Question)
- STEPPS: which 2+ principles does this script hit?
- Anti-patterns: have I avoided EVERY item in the content-type ANTI-PATTERNS list AND the anti-AI banned phrases?
- VO word count: every scene is 8s, so each script must be ≤20 words. Trim if over.
- Natural speech audit: does each script have at least ONE filler/restart/specific detail? If it reads like an ad copy, REWRITE.
- Image prompt audit: zero gender/hair/skin words? Starts with "Maintain exact identity..."? Has anti-AI realism cues (iPhone, candid, natural skin texture)? Banned aesthetic words absent?
- Veo prompt audit: structured format (PROMPT/CAMERA/DETAILS/CONTEXT/ENVIRONMENT/NEGATIVE)? Two-beat motion described (shift at midpoint)? DIALOGUE field present and matches script VERBATIM (or "no dialogue" for POV Hand)?
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
    max_tokens: 16000,
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
    // Force 8s per scene (Veo max) so the mid-scene cut has room to breathe
    return parsed.scenes.slice(0, sceneCount).map((s, i) => ({
      ...s,
      scene_number: i + 1,
      duration: 8,
    }))
  } catch (err) {
    throw new AnthropicError(`Failed to parse scene JSON: ${err instanceof Error ? err.message : err}`)
  }
}
