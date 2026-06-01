import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Flame, FileVideo, X, Upload as UploadIcon, Loader2, KeyRound,
  Eye, Gauge, Share2, Scissors, Clock, Smile,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { getToken } from '@/lib/api'
import { formatBytes, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth'
import type { ViralityResult } from '@/lib/types'

const EMOTION_STYLES: Record<string, { emoji: string; bg: string; text: string }> = {
  Kagum:   { emoji: '🤩', bg: 'bg-purple-500/20', text: 'text-purple-300' },
  Lucu:    { emoji: '😂', bg: 'bg-amber-500/20',  text: 'text-amber-300' },
  Edukasi: { emoji: '🧠', bg: 'bg-blue-500/20',   text: 'text-blue-300' },
  Marah:   { emoji: '😡', bg: 'bg-red-500/20',    text: 'text-red-300' },
}

function scoreColor(score: number) {
  if (score >= 95) return 'text-purple-400'
  if (score >= 90) return 'text-emerald-400'
  if (score >= 85) return 'text-blue-400'
  if (score >= 80) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBg(score: number) {
  if (score >= 95) return 'from-purple-500/20 to-fuchsia-500/20 border-purple-500/30'
  if (score >= 90) return 'from-emerald-500/20 to-green-500/20 border-emerald-500/30'
  if (score >= 85) return 'from-blue-500/20 to-cyan-500/20 border-blue-500/30'
  if (score >= 80) return 'from-amber-500/20 to-yellow-500/20 border-amber-500/30'
  return 'from-red-500/20 to-orange-500/20 border-red-500/30'
}

function scoreLabel(score: number) {
  if (score >= 95) return 'Mega Viral 🔥'
  if (score >= 90) return 'Sangat Viral'
  if (score >= 85) return 'Viral Potensial'
  if (score >= 80) return 'Cukup Bagus'
  return 'Perlu Polish'
}

export function ViralityPage() {
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
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
          AI Virality Score
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload draf video → AI nilai potensi viralnya (skor 75-99) + saran perbaikan
        </p>
      </div>

      {/* API key warning */}
      {!user?.hasGeminiKey && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <KeyRound className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-amber-300">Gemini API Key belum diatur</p>
                <p className="text-muted-foreground text-xs mt-1">
                  Set di Settings dulu. Sama dengan key yang dipakai Video to Prompt.
                </p>
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
          <CardTitle className="text-base">Upload Draf Video</CardTitle>
          <CardDescription>TikTok / Reels / Shorts draft yang belum kamu publish</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer hover:border-orange-500/50 transition-colors">
                <UploadIcon className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Klik untuk pilih video draf</p>
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
                <><Flame className="h-4 w-4" /> Hitung Virality Score</>
              )}
            </Button>
            {analyzing && (
              <p className="text-xs text-center text-muted-foreground">
                Upload ke Gemini → analisa konten → scoring. Bisa 30 detik—2 menit.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <>
          {/* Total Score */}
          <Card className={cn('bg-gradient-to-br', scoreBg(result.total_score))}>
            <CardContent className="p-8 text-center space-y-3">
              <div className="text-sm uppercase tracking-wider text-muted-foreground">Total Virality Score</div>
              <div className={cn('text-7xl md:text-8xl font-black tracking-tight', scoreColor(result.total_score))}>
                {result.total_score}
              </div>
              <div className={cn('text-lg font-semibold', scoreColor(result.total_score))}>
                {scoreLabel(result.total_score)}
              </div>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto pt-2">
                {result.summary}
              </p>
            </CardContent>
          </Card>

          {/* Criteria Breakdown */}
          <div className="grid md:grid-cols-3 gap-3">
            <CriterionCard
              icon={Eye}
              label="Visual & Audio Hook"
              weight="35%"
              score={result.visual_audio_hook.score}
              analysis={result.visual_audio_hook.analysis}
              iconColor="text-purple-400"
            />
            <CriterionCard
              icon={Gauge}
              label="Pacing & Retention"
              weight="30%"
              score={result.pacing_retention.score}
              analysis={result.pacing_retention.analysis}
              iconColor="text-blue-400"
            />
            <CriterionCard
              icon={Share2}
              label="Shareability"
              weight="35%"
              score={result.shareability.score}
              analysis={result.shareability.analysis}
              iconColor="text-emerald-400"
            />
          </div>

          {/* Critical Seconds */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-400" />
                Analisis 3 Detik Pertama (Kritis)
              </CardTitle>
              <CardDescription>Detik 0-3 adalah penentu, apakah viewer scroll atau nonton.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{result.critical_seconds_analysis}</p>
            </CardContent>
          </Card>

          {/* Cut Recommendation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Scissors className="h-4 w-4 text-red-400" />
                Rekomendasi Potong / Edit
              </CardTitle>
              <CardDescription>Bagian mana yang sebaiknya dipotong/dipercepat.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{result.cut_recommendation}</p>
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
              {(() => {
                const style = EMOTION_STYLES[result.predicted_emotion] ?? EMOTION_STYLES.Kagum
                return (
                  <div className={cn(
                    'flex items-center gap-4 rounded-xl p-5',
                    style.bg
                  )}>
                    <div className="text-5xl">{style.emoji}</div>
                    <div>
                      <div className={cn('text-2xl font-bold', style.text)}>
                        {result.predicted_emotion}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Emosi dominan yang akan dirasakan penonton
                      </div>
                    </div>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function CriterionCard({ icon: Icon, label, weight, score, analysis, iconColor }: {
  icon: typeof Eye
  label: string
  weight: string
  score: number
  analysis: string
  iconColor: string
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
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

        <Progress
          value={((score - 75) / (99 - 75)) * 100}
          className="h-1.5"
        />

        <p className="text-xs text-muted-foreground leading-relaxed">{analysis}</p>
      </CardContent>
    </Card>
  )
}
