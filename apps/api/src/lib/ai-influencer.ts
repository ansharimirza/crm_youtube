// AI Influencer — builds a Nano Banana image prompt from the wizard inputs.
// Single source of truth for prompt construction so the worker can regenerate
// after a "revise" without re-deriving everything.

export interface InfluencerSpec {
  name: string
  gender: 'female' | 'male'
  age: number
  niches: string[]
  backstory: string
  personality: number  // 0-100, 0=introvert
  ethnicity: string
  skinTone: string
  hairColor: string
  hairLength: string
  hairTexture: string
  eyeColor: string
  build: string
  customDescription: string
  aestheticVibe: string | null
  // refs influence prompt prefix
  hasFaceRef: boolean
  hasStyleRef: boolean
}

// Aesthetic vibe descriptions cover CLOTHING / MAKEUP / ACCESSORIES only.
// Hair-related cues are intentionally omitted so the user's explicit hair
// length / color / texture choices always win.
const AESTHETIC_DESCRIPTIONS: Record<string, string> = {
  Minimalist:   'clean, simple styling — neutral palette, no-fuss outfits, less is more',
  'Old Money':  'understated luxury — tailored basics, quiet wealth, heritage textures',
  'Clean Girl': 'effortless dewy no-makeup-makeup look, minimal jewelry like gold hoops',
  Editorial:    'high-fashion bold structured looks, dramatic silhouettes, magazine energy',
  Streetwear:   'urban casual street style — sneakers, oversized fits, graphic tees',
  Bohemian:     'earthy free-spirited textures — flowing fabric, layered jewelry, natural tones',
  Glam:         'dressy dramatic glamour — sequins, full beat makeup, statement jewelry',
  Preppy:       'classic collegiate polished — knits, loafers, structured pieces',
  Sporty:       'athletic activewear vibes — tracksuits, sneakers',
  'Dark & Moody': 'alternative edgy dramatic — leather, dark palette, moody lighting',
  Y2K:          '2000s nostalgia and pop culture — low-rise, baby tees, frosted lips',
  Cottagecore:  'romantic vintage nature aesthetic — florals, prairie dresses, soft tones',
  Coastal:      'linen nautical effortlessly sun-worn — beachy, breezy, light fabrics',
}

function personalityCue(level: number): string {
  if (level < 20) return 'reserved, thoughtful expression, soft eye contact, calm and introspective body language'
  if (level < 40) return 'gentle quiet confidence, subtle smile, composed presence'
  if (level < 60) return 'balanced and approachable expression — warm but grounded'
  if (level < 80) return 'open, confident, easy smile, relaxed gaze toward camera'
  return 'vibrant, charismatic, big bright smile, dynamic energetic stance'
}

function ageWording(age: number, gender: 'female' | 'male'): string {
  // Keep wording neutral — Gemini's safety filter trips on "young X" and named subjects.
  // We describe the subject as an adult only, never specify a precise age in years.
  const noun = gender === 'female' ? 'woman' : 'man'
  if (age < 25) return `adult ${noun} in their early twenties`
  if (age < 35) return `adult ${noun} in their late twenties to early thirties`
  if (age < 45) return `adult ${noun} in their late thirties to early forties`
  return `mature adult ${noun}`
}

export function buildInfluencerImagePrompt(spec: InfluencerSpec): string {
  const lines: string[] = []

  // Identity anchoring header
  if (spec.hasFaceRef) {
    lines.push(
      `Maintain exact facial identity from reference image 1 — do not invent a new face. ` +
      (spec.hasStyleRef ? `Reference image 2 sets the styling and aesthetic vibe. ` : '')
    )
  } else if (spec.hasStyleRef) {
    lines.push('Match the aesthetic and styling shown in reference image 1.')
  }

  // Subject — keep generic, no name, no "social media creator named X" which trips
  // Gemini's identifiable-person filter. Niches become a vibe/setting cue only.
  const niche = spec.niches.length > 0 ? spec.niches.join(', ').toLowerCase() : 'lifestyle'
  const subjectLine =
    `Portrait photograph of an ${ageWording(spec.age, spec.gender)} of ${spec.ethnicity.toLowerCase()} descent. ` +
    `The setting and styling should evoke a ${niche} vibe.`
  lines.push(subjectLine)

  // Physical
  const physical =
    `Physical: ${spec.skinTone.toLowerCase()} skin tone, ${spec.hairLength.toLowerCase()} ${spec.hairColor.toLowerCase()} ${spec.hairTexture.toLowerCase()} hair, ` +
    `${spec.eyeColor.toLowerCase()} eyes, ${spec.build.toLowerCase()} build.` +
    (spec.customDescription.trim() ? ` Distinctive details: ${spec.customDescription.trim()}.` : '')
  lines.push(physical)

  // Vibe / aesthetic
  if (spec.aestheticVibe && AESTHETIC_DESCRIPTIONS[spec.aestheticVibe]) {
    lines.push(`Aesthetic vibe: ${spec.aestheticVibe} — ${AESTHETIC_DESCRIPTIONS[spec.aestheticVibe]}.`)
  }

  // Personality cue (affects expression / pose)
  lines.push(`Demeanor: ${personalityCue(spec.personality)}.`)

  // Backstory hint (subtle influence on setting)
  if (spec.backstory.trim()) {
    lines.push(`Character context (subtle): ${spec.backstory.trim().slice(0, 300)}`)
  }

  // Photography style — anti-AI realism
  lines.push(
    `Photography: shot on iPhone 15 Pro, vertical 9:16, candid framing, natural skin texture with visible pores and subtle imperfections — NOT smoothed or glossy. ` +
    `Ambient room lighting with subtle color cast, slight motion blur from hand-hold, slightly desaturated natural color grading. ` +
    `Setting feels lived-in — small environmental clutter visible, not studio-perfect.`
  )

  // NB: Nano Banana / Gemini Imagen reads negative prompts as positive descriptors,
  // so we phrase the avoid-list as positive realism cues already included above
  // (natural skin, ambient light, no studio gloss, etc) instead of a NEGATIVE block.

  return lines.join('\n\n')
}
