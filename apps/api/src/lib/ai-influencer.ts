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

const AESTHETIC_DESCRIPTIONS: Record<string, string> = {
  Minimalist:   'clean, simple styling — neutral palette, no-fuss outfits, less is more',
  'Old Money':  'understated luxury — tailored basics, quiet wealth, heritage textures',
  'Clean Girl': 'effortless dewy no-makeup-makeup look, slicked-back hair, gold hoops',
  Editorial:    'high-fashion bold structured looks, dramatic silhouettes, magazine energy',
  Streetwear:   'urban casual street style — sneakers, oversized fits, graphic tees',
  Bohemian:     'earthy free-spirited textures — flowing fabric, layered jewelry, natural tones',
  Glam:         'dressy dramatic glamour — sequins, sleek hair, full beat makeup',
  Preppy:       'classic collegiate polished — knits, loafers, structured pieces',
  Sporty:       'athletic activewear vibes — tracksuits, sneakers, baseball caps',
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
  // We avoid words that override identity if face-ref provided; this is a generic anchor
  if (age < 18) return `${age}-year-old`
  if (age < 25) return `early twenties ${gender === 'female' ? 'young woman' : 'young man'}`
  if (age < 35) return `late twenties to early thirties ${gender === 'female' ? 'woman' : 'man'}`
  if (age < 45) return `late thirties to early forties ${gender === 'female' ? 'woman' : 'man'}`
  return `mature ${gender === 'female' ? 'woman' : 'man'}, ${age} years old`
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

  // Subject
  const niche = spec.niches.length > 0 ? spec.niches.join(', ').toLowerCase() : 'lifestyle'
  const subjectLine =
    `Portrait photograph of a ${ageWording(spec.age, spec.gender)} ${spec.ethnicity.toLowerCase()} ` +
    `social media content creator named ${spec.name}, who creates ${niche} content.`
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

  // Negative / banned
  lines.push(
    `NEGATIVE: airbrushed plastic skin, magazine retouching, studio softbox, perfect symmetry, ` +
    `cinematic luxury, glossy magazine cover, fashion editorial polish, fake AI face, distorted hands.`
  )

  return lines.join('\n\n')
}
