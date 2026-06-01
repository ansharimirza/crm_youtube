import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Flame, FileVideo, X, Upload as UploadIcon, Loader2, KeyRound, Copy, Check,
  Eye, Gauge, Heart, Share2, Smartphone, Scissors, Clock, Smile,
  Sparkles, CheckCircle2, XCircle, Music2, Instagram, Youtube,
  Hash, MessageCircle, Globe2, Lightbulb, Award, Zap, TrendingUp,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { getToken } from '@/lib/api'
import { formatBytes, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth'
import type {
  ViralityResult, Platform, HookPattern, ViralityEmotion, SteppsItem,
} from '@/lib/types'

const EMOTION_STYLES: Record<ViralityEmotion, { emoji: string; bg: string; text: string }> = {
  Kagum:      { emoji: '🤩', bg: 'bg-purple-500/20', text: 'text-purple-300' },
  Lucu:       { emoji: '😂', bg: 'bg-amber-500/20',  text: 'text-amber-300' },
  Edukasi:    { emoji: '🧠', bg: 'bg-blue-500/20',   text: 'text-blue-300' },
  Marah:      { emoji: '😡', bg: 'bg-red-500/20',    text: 'text-red-300' },
  Penasaran:  { emoji: '🤔', bg: 'bg-cyan-500/20',   text: 'text-cyan-300' },
  Inspiratif: { emoji: '✨', bg: 'bg-yellow-500/20', text: 'text-yellow-300' },
  Relatable:  { emoji: '🫶', bg: 'bg-pink-500/20',   text: 'text-pink-300' },
  Shock:      { emoji: '😱', bg: 'bg-rose-500/20',   text: 'text-rose-300' },
}

const HOOK_PATTERN_DESC: Record<HookPattern, { color: string; desc: string }> = {
  'Bold Claim':      { color: 'text-red-300',    desc: 'Klaim mengejutkan yang challenge asumsi viewer' },
  'Curiosity Gap':   { color: 'text-cyan-300',   desc: 'Hint informasi yang ditahan, bikin penasaran' },
  'Micro-Story':     { color: 'text-purple-300', desc: 'Drop viewer di tengah cerita yang sudah berjalan' },
  'Visual Shock':    { color: 'text-amber-300',  desc: 'Frame visual yang interrupt scrolling pattern' },
  'Direct Question': { color: 'text-blue-300',   desc: 'Pertanyaan langsung yang relate ke viewer' },
  'None':            { color: 'text-gray-400',   desc: 'Tidak ada hook yang jelas terdeteksi' },
}

const PLATFORMS = [
  { value: 'tiktok' as Platform, label: 'TikTok',       icon: Music2,    color: 'text-pink-400' },
  { value: 'reels' as Platform,  label: 'IG Reels',     icon: Instagram, color: 'text-purple-400' },
  { value: 'shorts' as Platform, label: 'YT Shorts',    icon: Youtube,   color: 'text-red-400' },
]

function scoreColor(score: number) {
  if (score >= 90) return 'text-emerald-400'
  if (score >= 75) return 'text-blue-400'
  if (score >= 60) return 'text-amber-400'
  if (score >= 40) return 'text-orange-400'
  return 'text-red-400'
}

function scoreBg(score: number) {
  if (score >= 90) return 'from-emerald-500/20 to-green-500/20 border-emerald-500/30'
  if (score >= 75) return 'from-blue-500/20 to-cyan-500/20 border-blue-500/30'
  if (score >= 60) return 'from-amber-500/20 to-yellow-500/20 border-amber-500/30'
  if (score >= 40) return 'from-orange-500/20 to-red-500/20 border-orange-500/30'
  return 'from-red-500/20 to-rose-500/20 border-red-500/30'
}

function scoreLabel(score: number) {
  if (score >= 90) return 'Sangat Viral 🔥'
  if (score >= 75) return 'Viral Potensial'
  if (score >= 60) return 'Cukup Bagus'
  if (score >= 40) return 'Perlu Polish'
  return 'Butuh Rework'
}

function completionLabel(rate: number) {
  if (rate >= 80) return { text: 'High Viral Potential', color: 'text-emerald-400' }
  if (rate >= 60) return { text: 'High Potential', color: 'text-blue-400' }
  if (rate >= 40) return { text: 'Medium', color: 'text-amber-400' }
  return { text: 'Low / No Viral', color: 'text-red-400' }
}

export function ViralityPage() {
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [platform, setPlatform] = useState<Platform>('tiktok')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<ViralityResult | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file) {
      toast.error('Pilih video dulu')
      return
    }
    setAnalyzing(true)
    setResult(null)

    try {
      const fd = new FormData()
      fd.append('video', file)
      fd.append('platform', platform)
      const res = await fetch('/api/virality/score', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResult(data.result)
      toast.success(`Score: ${data.result.total_score}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Analisa gagal')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Flame className="h-6 w-6 text-orange-400" />
          AI Virality Score Engine
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Score draft 0-99 + diagnostik hook + rekomendasi cut spesifik
        </p>
      </div>

      {!user?.hasGeminiKey && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <KeyRound className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-amber-300">Gemini API Key belum diatur</p>
                <p className="text-muted-foreground text-xs mt-1">Set di Settings. Sama dengan key Video to Prompt.</p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/settings">Ke Settings →</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Draft + Pilih Platform</CardTitle>
          <CardDescription>Scoring disesuaikan dengan signal algoritma platform target</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Platform selector */}
            <div className="space-y-2">
              <Label>Platform Target</Label>
              <div className="grid grid-cols-3 gap-2">
                {PLATFORMS.map(({ value, label, icon: Icon, color }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPlatform(value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-all',
                      platform === value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/30'
                    )}
                  >
                    <Icon className={cn('h-5 w-5', color)} />
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* File picker */}
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <FileVideo className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => setFile(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer hover:border-orange-500/50 transition-colors">
                <UploadIcon className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Klik untuk pilih video draft</p>
                  <p className="text-xs text-muted-foreground mt-1">MP4 / MOV / MKV</p>
                </div>
                <input
                  type="file"
                  accept="video/*,.mkv"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}

            <Button type="submit" disabled={!file || analyzing} size="lg" className="w-full bg-orange-600 hover:bg-orange-700">
              {analyzing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Menilai virality...</>
              ) : (
                <><Flame className="h-4 w-4" /> Score untuk {PLATFORMS.find(p => p.value === platform)?.label}</>
              )}
            </Button>
            {analyzing && (
              <p className="text-xs text-center text-muted-foreground">
                Upload → diagnostik hook → rubric scoring → rekomendasi. ~30s-2 menit.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {result && <ResultSection result={result} />}
    </div>
  )
}

function ResultSection({ result }: { result: ViralityResult }) {
  const completion = completionLabel(result.predicted_completion_rate)
  const emoStyle = EMOTION_STYLES[result.predicted_emotion.primary]
  const hookDesc = HOOK_PATTERN_DESC[result.hook_diagnosis.pattern_detected]

  return (
    <>
      {/* Total Score Hero */}
      <Card className={cn('bg-gradient-to-br', scoreBg(result.total_score))}>
        <CardContent className="p-6 md:p-8 text-center space-y-3">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Total Virality Score</div>
          <div className={cn('text-7xl md:text-8xl font-black tracking-tight', scoreColor(result.total_score))}>
            {result.total_score}
            <span className="text-3xl md:text-4xl text-muted-foreground/60">/99</span>
          </div>
          <div className={cn('text-lg font-semibold', scoreColor(result.total_score))}>
            {scoreLabel(result.total_score)}
          </div>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto pt-2">{result.summary}</p>
        </CardContent>
      </Card>

      {/* Predicted Completion Rate */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <TrendingUp className={cn('h-8 w-8 shrink-0', completion.color)} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">Predicted Completion Rate</div>
              <div className="flex items-baseline gap-2">
                <span className={cn('text-3xl font-bold', completion.color)}>
                  {result.predicted_completion_rate}%
                </span>
                <span className={cn('text-sm font-medium', completion.color)}>{completion.text}</span>
              </div>
              <Progress value={result.predicted_completion_rate} className="h-1.5 mt-2" />
              <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                <span>0%</span>
                <span>40% (medium)</span>
                <span>80% (viral)</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5 Criteria Breakdown */}
      <div className="grid md:grid-cols-2 gap-3">
        <CriterionCard icon={Zap}      label="Hook Strength"     weight="30%" {...result.criteria.hook_strength}    iconColor="text-purple-400" />
        <CriterionCard icon={Gauge}    label="Pacing & Retention" weight="20%" {...result.criteria.pacing_retention} iconColor="text-blue-400" />
        <CriterionCard icon={Heart}    label="Emotional Payload" weight="20%" {...result.criteria.emotional_payload} iconColor="text-pink-400" />
        <CriterionCard icon={Share2}   label="Shareability (STEPPS)" weight="20%" {...result.criteria.shareability}  iconColor="text-emerald-400" />
        <CriterionCard icon={Smartphone} label="Platform Fit"    weight="10%" {...result.criteria.platform_fit}     iconColor="text-cyan-400" className="md:col-span-2" />
      </div>

      {/* Hook Diagnosis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-purple-400" />
            Hook Diagnosis (0-3 Detik)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Pattern Terdeteksi</div>
            <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
              <span className={cn('text-lg font-bold', hookDesc.color)}>
                {result.hook_diagnosis.pattern_detected}
              </span>
              <span className="text-xs text-muted-foreground">{hookDesc.desc}</span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-emerald-300 mb-2 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Strength Indicators
              </div>
              {result.hook_diagnosis.strength_indicators.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Tidak ada strength terdeteksi</p>
              ) : (
                <ul className="space-y-1">
                  {result.hook_diagnosis.strength_indicators.map((s, i) => (
                    <li key={i} className="text-xs flex gap-2">
                      <span className="text-emerald-400 shrink-0">✓</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="text-xs font-medium text-red-300 mb-2 flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                Weakness Indicators
              </div>
              {result.hook_diagnosis.weakness_indicators.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Tidak ada weakness terdeteksi</p>
              ) : (
                <ul className="space-y-1">
                  {result.hook_diagnosis.weakness_indicators.map((s, i) => (
                    <li key={i} className="text-xs flex gap-2">
                      <span className="text-red-400 shrink-0">✗</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cut Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Scissors className="h-4 w-4 text-red-400" />
            Rekomendasi Cut / Edit
          </CardTitle>
          <CardDescription>Bagian-bagian spesifik yang harus dipotong/dipercepat</CardDescription>
        </CardHeader>
        <CardContent>
          {result.cut_recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Video sudah cukup tight, tidak ada rekomendasi cut.</p>
          ) : (
            <div className="space-y-2">
              {result.cut_recommendations.map((cut, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      <Clock className="h-3 w-3" />
                      {cut.timestamp_start}–{cut.timestamp_end}
                    </Badge>
                    <Badge variant="destructive" className="text-xs">{cut.issue}</Badge>
                    <Badge className="text-xs">{cut.action}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{cut.reason}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* STEPPS Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="h-4 w-4 text-emerald-400" />
            STEPPS Breakdown (Jonah Berger framework)
          </CardTitle>
          <CardDescription>6 faktor shareability yang bikin orang mau share</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-2">
          <SteppsRow icon={Award}        label="Social Currency" item={result.stepps_breakdown.social_currency} />
          <SteppsRow icon={Hash}         label="Triggers"        item={result.stepps_breakdown.triggers} />
          <SteppsRow icon={Heart}        label="Emotion"         item={result.stepps_breakdown.emotion} />
          <SteppsRow icon={Globe2}       label="Public"          item={result.stepps_breakdown.public} />
          <SteppsRow icon={Lightbulb}    label="Practical Value" item={result.stepps_breakdown.practical_value} />
          <SteppsRow icon={MessageCircle} label="Stories"        item={result.stepps_breakdown.stories} />
        </CardContent>
      </Card>

      {/* Predicted Emotion */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Smile className="h-4 w-4 text-pink-400" />
            Prediksi Emosi Penonton
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={cn('flex items-center gap-4 rounded-xl p-5', emoStyle.bg)}>
            <div className="text-5xl">{emoStyle.emoji}</div>
            <div className="flex-1">
              <div className={cn('text-2xl font-bold', emoStyle.text)}>
                {result.predicted_emotion.primary}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{result.predicted_emotion.arc_description}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alternative Hooks */}
      {result.alternative_hooks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-yellow-400" />
              Alternative Hooks (Saran Pengganti)
            </CardTitle>
            <CardDescription>3 alternatif opening line untuk meningkatkan hook strength</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.alternative_hooks.map((hook, i) => (
              <AlternativeHookCard key={i} pattern={hook.pattern} text={hook.text} />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}

function CriterionCard({ icon: Icon, label, weight, score, analysis, detected_signals, iconColor, className }: {
  icon: typeof Eye
  label: string
  weight: string
  score: number
  analysis: string
  detected_signals: string[]
  iconColor: string
  className?: string
}) {
  return (
    <Card className={className}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className={cn('h-4 w-4', iconColor)} />
            <span className="text-sm font-medium">{label}</span>
          </div>
          <Badge variant="outline" className="text-xs">{weight}</Badge>
        </div>

        <div className="flex items-baseline gap-2">
          <span className={cn('text-3xl font-bold', scoreColor(score))}>{score}</span>
          <span className="text-xs text-muted-foreground">/ 99</span>
        </div>

        <Progress value={score} className="h-1.5" />

        <p className="text-xs text-muted-foreground leading-relaxed">{analysis}</p>

        {detected_signals.length > 0 && (
          <div className="border-t pt-2 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Detected Signals</div>
            <ul className="space-y-0.5">
              {detected_signals.map((s, i) => (
                <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                  <span className="text-primary shrink-0">›</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SteppsRow({ icon: Icon, label, item }: {
  icon: typeof Award
  label: string
  item: SteppsItem
}) {
  return (
    <div className={cn(
      'flex items-start gap-2 rounded-lg border p-2.5',
      item.hit ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-muted/20 border-border'
    )}>
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', item.hit ? 'text-emerald-400' : 'text-muted-foreground')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-medium', item.hit ? 'text-emerald-300' : 'text-muted-foreground')}>
            {label}
          </span>
          {item.hit ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          ) : (
            <XCircle className="h-3 w-3 text-muted-foreground/40" />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">{item.note}</p>
      </div>
    </div>
  )
}

function AlternativeHookCard({ pattern, text }: { pattern: HookPattern; text: string }) {
  const [copied, setCopied] = useState(false)
  const desc = HOOK_PATTERN_DESC[pattern]

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      toast.success('Hook disalin')
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="outline" className={cn('text-xs', desc.color)}>{pattern}</Badge>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copy}>
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </Button>
      </div>
      <p className="text-sm font-medium">{text}</p>
    </div>
  )
}
