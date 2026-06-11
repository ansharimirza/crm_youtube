import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowRight, Loader2, CheckCircle2, Sparkles,
  ImagePlus, X, Shuffle, User, UserCircle2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { getToken } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const NICHES = ['Fashion', 'Beauty', 'Lifestyle', 'Fitness', 'Travel', 'Food & Dining', 'Tech', 'Gaming', 'Finance', 'Entertainment', 'Wellness', 'Sports', 'Other']
const ETHNICITIES = ['White', 'Black', 'Hispanic', 'East Asian', 'South Asian', 'Middle Eastern', 'Southeast Asian', 'Mixed']
const SKIN_TONES = [
  { v: 'Fair', c: 'bg-orange-100' }, { v: 'Light', c: 'bg-orange-200' },
  { v: 'Medium', c: 'bg-orange-300' }, { v: 'Tan', c: 'bg-orange-500' },
  { v: 'Brown', c: 'bg-amber-700' }, { v: 'Deep', c: 'bg-amber-900' },
  { v: 'Ebony', c: 'bg-stone-900' },
]
const HAIR_COLORS = [
  { v: 'Blonde', c: 'bg-yellow-200' }, { v: 'Brunette', c: 'bg-amber-700' },
  { v: 'Black', c: 'bg-stone-900' }, { v: 'Auburn', c: 'bg-orange-600' },
  { v: 'Red', c: 'bg-red-600' }, { v: 'Silver', c: 'bg-stone-300' },
  { v: 'Dyed', c: 'bg-pink-400' },
]
const HAIR_LENGTHS = ['Short', 'Medium', 'Long', 'Extra long']
const HAIR_TEXTURES = ['Straight', 'Wavy', 'Curly', 'Coily']
const EYE_COLORS = [
  { v: 'Blue', c: 'bg-blue-400' }, { v: 'Green', c: 'bg-green-500' },
  { v: 'Brown', c: 'bg-amber-700' }, { v: 'Hazel', c: 'bg-yellow-700' },
  { v: 'Dark', c: 'bg-stone-900' }, { v: 'Grey', c: 'bg-stone-400' },
]
const BUILDS = ['Petite', 'Slim', 'Athletic', 'Average', 'Curvy', 'Tall', 'Plus']
const AESTHETIC_VIBES = [
  { v: 'Minimalist',   emoji: '🤍', desc: 'Clean, simple, less is more' },
  { v: 'Old Money',    emoji: '💰', desc: 'Understated wealth & heritage' },
  { v: 'Clean Girl',   emoji: '✨', desc: 'Effortless, dewy, no-makeup look' },
  { v: 'Editorial',    emoji: '📷', desc: 'High fashion, bold & structured' },
  { v: 'Streetwear',   emoji: '🛹', desc: 'Urban, casual street style' },
  { v: 'Bohemian',     emoji: '🌿', desc: 'Earthy, flowy, free-spirited' },
  { v: 'Glam',         emoji: '💎', desc: 'Dressy, dramatic & glamorous' },
  { v: 'Preppy',       emoji: '🎓', desc: 'Classic, collegiate, polished' },
  { v: 'Sporty',       emoji: '⚡', desc: 'Athletic & activewear vibes' },
  { v: 'Dark & Moody', emoji: '🌙', desc: 'Alternative, edgy & dramatic' },
  { v: 'Y2K',          emoji: '🦄', desc: '2000s nostalgia & pop culture' },
  { v: 'Cottagecore',  emoji: '🌸', desc: 'Romantic, vintage & nature' },
  { v: 'Coastal',      emoji: '🌊', desc: 'Linen, nautical, sun-worn' },
]

interface WizardState {
  step: 1 | 2 | 3 | 4
  name: string
  gender: 'female' | 'male' | null
  age: string
  niches: string[]
  faceRef: File | null
  faceRefPreview: string | null
  styleRef: File | null
  styleRefPreview: string | null
  backstory: string
  personality: number
  ethnicity: string
  skinTone: string
  hairColor: string
  hairLength: string
  hairTexture: string
  eyeColor: string
  build: string
  customDescription: string
  aestheticVibe: string | null
}

const initial: WizardState = {
  step: 1,
  name: '',
  gender: null,
  age: '',
  niches: [],
  faceRef: null,
  faceRefPreview: null,
  styleRef: null,
  styleRefPreview: null,
  backstory: '',
  personality: 50,
  ethnicity: '',
  skinTone: '',
  hairColor: '',
  hairLength: 'Long',
  hairTexture: 'Straight',
  eyeColor: '',
  build: '',
  customDescription: '',
  aestheticVibe: null,
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function AiInfluencerNewPage() {
  const navigate = useNavigate()
  const [s, setS] = useState<WizardState>(initial)

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setS(prev => ({ ...prev, [key]: value }))
  }

  function next() { update('step', Math.min(4, s.step + 1) as WizardState['step']) }
  function back() { update('step', Math.max(1, s.step - 1) as WizardState['step']) }

  function toggleNiche(n: string) {
    update('niches', s.niches.includes(n) ? s.niches.filter(x => x !== n) : [...s.niches, n])
  }

  function handleFile(file: File | null, kind: 'face' | 'style') {
    if (!file) return
    const key = kind === 'face' ? 'faceRef' : 'styleRef'
    const previewKey = kind === 'face' ? 'faceRefPreview' : 'styleRefPreview'
    update(key as 'faceRef', file as never)
    const reader = new FileReader()
    reader.onload = (e) => update(previewKey as 'faceRefPreview', e.target?.result as string)
    reader.readAsDataURL(file)
  }

  function randomizePhysical() {
    setS(prev => ({
      ...prev,
      ethnicity: pick(ETHNICITIES),
      skinTone: pick(SKIN_TONES).v,
      hairColor: pick(HAIR_COLORS).v,
      hairLength: pick(HAIR_LENGTHS),
      hairTexture: pick(HAIR_TEXTURES),
      eyeColor: pick(EYE_COLORS).v,
      build: pick(BUILDS),
    }))
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('name', s.name)
      fd.append('gender', s.gender!)
      fd.append('age', s.age)
      fd.append('niches', s.niches.join('|'))
      if (s.faceRef) fd.append('face_ref', s.faceRef)
      if (s.styleRef) fd.append('style_ref', s.styleRef)
      fd.append('backstory', s.backstory)
      fd.append('personality', String(s.personality))
      fd.append('ethnicity', s.ethnicity)
      fd.append('skin_tone', s.skinTone)
      fd.append('hair_color', s.hairColor)
      fd.append('hair_length', s.hairLength)
      fd.append('hair_texture', s.hairTexture)
      fd.append('eye_color', s.eyeColor)
      fd.append('build', s.build)
      fd.append('custom_description', s.customDescription)
      if (s.aestheticVibe) fd.append('aesthetic_vibe', s.aestheticVibe)

      const res = await fetch('/api/ai-influencer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(`${s.name} sedang di-generate!`)
      navigate(`/influencer/${data.influencer.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const personalityLabel =
    s.personality < 30 ? 'Introvert' :
    s.personality < 45 ? 'Reserved' :
    s.personality < 55 ? 'Balanced & versatile' :
    s.personality < 75 ? 'Outgoing' : 'Extrovert'

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/influencer">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <div className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
              s.step >= n ? 'bg-gradient-to-br from-pink-500 to-violet-500 text-white' : 'bg-muted text-muted-foreground'
            )}>
              {s.step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
            </div>
            {n < 4 && <div className={cn('flex-1 h-0.5', s.step > n ? 'bg-gradient-to-r from-pink-500 to-violet-500' : 'bg-muted')} />}
          </div>
        ))}
      </div>

      {/* ===== STEP 1: BASICS ===== */}
      {s.step === 1 && (
        <Card>
          <CardContent className="p-6 space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Name your influencer</h1>
              <p className="text-sm text-muted-foreground mt-1">Start with the basics — you can always refine later.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Name</Label>
              <Input
                value={s.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="e.g. Luna Rose"
                maxLength={100}
                className="border-violet-500/50"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Gender</Label>
              <div className="grid grid-cols-2 gap-3">
                {(['female', 'male'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => update('gender', g)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-lg border-2 p-5 transition-all',
                      s.gender === g ? 'border-violet-500 bg-violet-500/5' : 'border-border hover:border-violet-500/30'
                    )}
                  >
                    {g === 'female' ? <User className="h-6 w-6 text-pink-400" /> : <UserCircle2 className="h-6 w-6 text-blue-400" />}
                    <span className="font-medium capitalize">{g}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Age</Label>
              <Input
                type="number"
                min={16} max={70}
                value={s.age}
                onChange={(e) => update('age', e.target.value)}
                placeholder="e.g. 24"
                className="w-32"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                Niche <span className="text-[10px] normal-case font-normal text-muted-foreground/60">pick all that apply</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {NICHES.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleNiche(n)}
                    className={cn(
                      'px-3.5 py-1.5 rounded-full border text-sm transition-colors',
                      s.niches.includes(n)
                        ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                        : 'border-border text-muted-foreground hover:border-violet-500/30'
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={next}
                disabled={!s.name || !s.gender || !s.age || Number(s.age) < 16}
                className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== STEP 2: REFERENCES ===== */}
      {s.step === 2 && (
        <Card>
          <CardContent className="p-6 space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Add references</h1>
              <p className="text-sm text-muted-foreground mt-1">Both optional — the more you give, the closer the result.</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {/* Face reference */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Face reference <span className="text-[10px] normal-case font-normal text-muted-foreground/60">optional</span>
                </Label>
                {s.faceRefPreview ? (
                  <div className="relative">
                    <img src={s.faceRefPreview} className="rounded-lg w-full aspect-[3/4] object-cover border" alt="" />
                    <Button
                      type="button" size="icon" variant="secondary"
                      className="absolute top-2 right-2 h-7 w-7"
                      onClick={() => { update('faceRef', null); update('faceRefPreview', null) }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 aspect-[3/4] border-2 border-dashed rounded-lg cursor-pointer hover:border-violet-500/50">
                    <ImagePlus className="h-8 w-8 text-muted-foreground/50" />
                    <p className="font-medium text-sm">Upload photo</p>
                    <p className="text-xs text-muted-foreground">A photo of the face you want</p>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null, 'face')} />
                  </label>
                )}
              </div>

              {/* Style reference */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Style reference <span className="text-[10px] normal-case font-normal text-muted-foreground/60">optional</span>
                </Label>
                {s.styleRefPreview ? (
                  <div className="relative">
                    <img src={s.styleRefPreview} className="rounded-lg w-full aspect-[3/4] object-cover border" alt="" />
                    <Button
                      type="button" size="icon" variant="secondary"
                      className="absolute top-2 right-2 h-7 w-7"
                      onClick={() => { update('styleRef', null); update('styleRefPreview', null) }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 aspect-[3/4] border-2 border-dashed rounded-lg cursor-pointer hover:border-violet-500/50">
                    <ImagePlus className="h-8 w-8 text-muted-foreground/50" />
                    <p className="font-medium text-sm">Upload photo</p>
                    <p className="text-xs text-muted-foreground">Outfit, aesthetic, or vibe inspo</p>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null, 'style')} />
                  </label>
                )}
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back</Button>
              <Button onClick={next} className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== STEP 3: PERSONA ===== */}
      {s.step === 3 && (
        <Card>
          <CardContent className="p-6 space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Who are they?</h1>
              <p className="text-sm text-muted-foreground mt-1">Their story, vibe, what makes them different.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Backstory <span className="text-[10px] normal-case font-normal text-muted-foreground/60">optional</span>
              </Label>
              <Textarea
                value={s.backstory}
                onChange={(e) => update('backstory', e.target.value)}
                placeholder="Their background, what drives them, what makes them unique..."
                rows={5}
                className="border-violet-500/50"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Personality</Label>
              <input
                type="range" min={0} max={100} step={1}
                value={s.personality}
                onChange={(e) => update('personality', Number(e.target.value))}
                className="w-full accent-violet-500"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Introvert</span>
                <span className="px-3 py-1 rounded-full border border-violet-500/50 text-violet-300">{personalityLabel}</span>
                <span>Extrovert</span>
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back</Button>
              <Button onClick={next} className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== STEP 4: LOOKS ===== */}
      {s.step === 4 && (
        <>
          <Card>
            <CardContent className="p-6 space-y-6">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">How do they look?</h1>
                <p className="text-sm text-muted-foreground mt-1">Physical features and aesthetic — this shapes the AI generation.</p>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">Physical appearance</h3>
                <Button size="sm" variant="outline" onClick={randomizePhysical}>
                  <Shuffle className="h-3 w-3" /> Randomize
                </Button>
              </div>

              <ChipGroup label="🌍 Ethnicity" options={ETHNICITIES} value={s.ethnicity} onChange={(v) => update('ethnicity', v)} />

              <ColorChipGroup label="🤎 Skin tone" options={SKIN_TONES} value={s.skinTone} onChange={(v) => update('skinTone', v)} />

              <ColorChipGroup label="💇 Hair" options={HAIR_COLORS} value={s.hairColor} onChange={(v) => update('hairColor', v)} />
              <div className="grid grid-cols-2 gap-4">
                <ChipGroup label="Length" options={HAIR_LENGTHS} value={s.hairLength} onChange={(v) => update('hairLength', v)} small />
                <ChipGroup label="Texture" options={HAIR_TEXTURES} value={s.hairTexture} onChange={(v) => update('hairTexture', v)} small />
              </div>

              <ColorChipGroup label="👁 Eye color" options={EYE_COLORS} value={s.eyeColor} onChange={(v) => update('eyeColor', v)} />

              <ChipGroup label="🧍 Build" options={BUILDS} value={s.build} onChange={(v) => update('build', v)} />

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  ✨ Custom description <span className="text-[10px] normal-case font-normal text-muted-foreground/60">optional</span>
                </Label>
                <Input
                  value={s.customDescription}
                  onChange={(e) => update('customDescription', e.target.value)}
                  placeholder="Anything else — freckles, dimples, beauty mark, tattoos..."
                  maxLength={500}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-4">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Aesthetic vibe <span className="text-[10px] normal-case font-normal text-muted-foreground/60">optional</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {AESTHETIC_VIBES.map(({ v, emoji, desc }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => update('aestheticVibe', s.aestheticVibe === v ? null : v)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
                      s.aestheticVibe === v ? 'border-violet-500 bg-violet-500/10' : 'border-border hover:border-violet-500/30'
                    )}
                  >
                    <div className="text-xs flex items-center gap-1.5">
                      <span>{emoji}</span>
                      <span className="font-semibold">{v}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{desc}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back</Button>
            <Button
              size="lg"
              onClick={() => createMutation.mutate()}
              disabled={!s.ethnicity || !s.skinTone || !s.hairColor || !s.eyeColor || !s.build || createMutation.isPending}
              className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Continue to Generate <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function ChipGroup({ label, options, value, onChange, small }: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
  small?: boolean
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'px-3 py-1.5 rounded-full border text-xs transition-colors',
              value === opt ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-border text-muted-foreground hover:border-violet-500/30',
              small && 'py-1 text-[11px]'
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

function ColorChipGroup({ label, options, value, onChange }: {
  label: string
  options: { v: string; c: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(({ v, c }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-colors',
              value === v ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-border text-muted-foreground hover:border-violet-500/30'
            )}
          >
            <span className={cn('h-2.5 w-2.5 rounded-full', c)} />
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}
