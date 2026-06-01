import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  Wand2, Upload as UploadIcon, FileVideo, X, Loader2, Copy, Check,
  Image as ImageIcon, Film, Clock, KeyRound, Sparkles, Send, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, getToken } from '@/lib/api'
import { cn, formatBytes } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth'
import type { AnalyzedScene, AnalyzeResult, VeoProjectSummary } from '@/lib/types'

export function AnalyzerPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [editedScenes, setEditedScenes] = useState<AnalyzedScene[] | null>(null)
  const [targetProjectId, setTargetProjectId] = useState<string>('')
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('9:16')
  const [resolution, setResolution] = useState<'720p' | '1080p'>('1080p')
  const [modelOverride, setModelOverride] = useState<string>('ai')

  const { data: projData } = useQuery({
    queryKey: ['veo-projects'],
    queryFn: () => api.get<{ projects: VeoProjectSummary[] }>('/api/veo/projects'),
  })
  const projects = projData?.projects ?? []

  const addMutation = useMutation({
    mutationFn: (payload: {
      project_id: number
      scenes: AnalyzedScene[]
      aspect_ratio: '16:9' | '9:16'
      resolution: '720p' | '1080p'
      model?: string
    }) => api.post<{ created: number[] }>('/api/analyzer/add-to-project', payload),
    onSuccess: (data, vars) => {
      toast.success(`${data.created.length} scene di-tambahkan & mulai generate`)
      qc.invalidateQueries({ queryKey: ['veo-project', String(vars.project_id)] })
      navigate(`/veo/${vars.project_id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function handleAnalyze(e: FormEvent) {
    e.preventDefault()
    if (!file) {
      toast.error('Pilih video dulu')
      return
    }
    setAnalyzing(true)
    setResult(null)
    setEditedScenes(null)

    try {
      const fd = new FormData()
      fd.append('video', file)
      const res = await fetch('/api/analyzer/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResult(data.result)
      setEditedScenes(data.result.scenes)
      toast.success(`Analisa selesai — ${data.result.scenes.length} scene`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Analisa gagal')
    } finally {
      setAnalyzing(false)
    }
  }

  function updateScene(idx: number, patch: Partial<AnalyzedScene>) {
    setEditedScenes(prev => prev?.map((s, i) => i === idx ? { ...s, ...patch } : s) ?? null)
  }

  function removeScene(idx: number) {
    setEditedScenes(prev => prev?.filter((_, i) => i !== idx) ?? null)
  }

  function handleAddToProject() {
    if (!editedScenes || editedScenes.length === 0) {
      toast.error('Tidak ada scene untuk di-add')
      return
    }
    if (!targetProjectId) {
      toast.error('Pilih project tujuan')
      return
    }
    addMutation.mutate({
      project_id: Number(targetProjectId),
      scenes: editedScenes,
      aspect_ratio: aspectRatio,
      resolution,
      ...(modelOverride !== 'ai' ? { model: modelOverride } : {}),
    })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-primary" />
          Video to Prompt
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload video viral → AI pecah jadi scene + bikin prompt Veo siap pakai
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
                  Dapatkan gratis di <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">aistudio.google.com</a>, lalu set di Settings.
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
          <CardTitle className="text-base">Upload Video Referensi</CardTitle>
          <CardDescription>YouTube Shorts / TikTok / Reels (MP4, MOV) — maks ~100MB rekomendasi</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAnalyze} className="space-y-4">
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
              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer hover:border-primary/50 transition-colors">
                <UploadIcon className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Klik untuk pilih video</p>
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

            <Button type="submit" disabled={!file || analyzing} size="lg" className="w-full">
              {analyzing ? <><Loader2 className="h-4 w-4 animate-spin" /> Sedang menganalisa...</> : <><Wand2 className="h-4 w-4" /> Analisa Video</>}
            </Button>
            {analyzing && (
              <p className="text-xs text-center text-muted-foreground">
                Upload ke Gemini → wait processing → analisa. Bisa 30 detik sampai 2 menit tergantung ukuran video.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Result */}
      {result && editedScenes && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Hasil Analisa
              </CardTitle>
              <CardDescription>{result.summary}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                <strong className="text-foreground">{editedScenes.length} scene</strong> ter-deteksi.
                Edit prompt di bawah jika perlu sebelum add ke project.
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {editedScenes.map((scene, idx) => (
              <SceneResultCard
                key={idx}
                scene={scene}
                index={idx}
                onUpdate={(patch) => updateScene(idx, patch)}
                onRemove={() => removeScene(idx)}
              />
            ))}
          </div>

          {/* Add to project */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4 text-primary" />
                Add ke Veo Project
              </CardTitle>
              <CardDescription>Scene akan otomatis di-queue & generate dengan prompt yang sudah diedit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Project Tujuan</Label>
                <Select value={targetProjectId} onValueChange={setTargetProjectId}>
                  <SelectTrigger><SelectValue placeholder="Pilih project..." /></SelectTrigger>
                  <SelectContent>
                    {projects.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {projects.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Belum ada project — <Link to="/veo" className="text-primary hover:underline">buat dulu di Veo Studio</Link>
                  </p>
                )}
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Aspect Ratio</Label>
                  <Select value={aspectRatio} onValueChange={v => setAspectRatio(v as '9:16' | '16:9')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9:16">9:16 (Shorts/Reels)</SelectItem>
                      <SelectItem value="16:9">16:9 (Widescreen)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Resolution</Label>
                  <Select value={resolution} onValueChange={v => setResolution(v as '720p' | '1080p')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="720p">720p (HD)</SelectItem>
                      <SelectItem value="1080p">1080p (Full HD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Model Veo</Label>
                  <Select value={modelOverride} onValueChange={setModelOverride}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ai">Saran AI (per-scene)</SelectItem>
                      <SelectItem value="veo-3.1">Veo 3.1 (best quality)</SelectItem>
                      <SelectItem value="veo-3.1-fast">Veo 3.1 Fast</SelectItem>
                      <SelectItem value="veo-3.1-lite">Veo 3.1 Lite (audio)</SelectItem>
                      <SelectItem value="veo-2">Veo 2 (flex duration)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {modelOverride === 'ai' && (
                <p className="text-xs text-muted-foreground">
                  Tiap scene pakai model yang disarankan AI (lihat badge di kartu scene)
                </p>
              )}

              <Button
                onClick={handleAddToProject}
                disabled={!targetProjectId || editedScenes.length === 0 || addMutation.isPending}
                size="lg"
                className="w-full"
              >
                {addMutation.isPending ? 'Menambahkan...' : `Add ${editedScenes.length} Scene & Mulai Generate →`}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function SceneResultCard({
  scene, index, onUpdate, onRemove,
}: {
  scene: AnalyzedScene
  index: number
  onUpdate: (patch: Partial<AnalyzedScene>) => void
  onRemove: () => void
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  function copy(field: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      toast.success(`${field} disalin`)
      setTimeout(() => setCopiedField(null), 1500)
    })
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="default">Scene #{index + 1}</Badge>
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {scene.start_time}—{scene.end_time}
            </Badge>
            <Badge variant="secondary">{scene.duration_suggested}s</Badge>
            <Badge variant="secondary">{scene.veo_model_suggested}</Badge>
            {scene.mood && (
              <Badge variant="outline" className="italic">{scene.mood}</Badge>
            )}
          </div>
          <Button size="icon" variant="ghost" onClick={onRemove} className="text-red-400 hover:bg-red-500/10">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Image Prompt */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs flex items-center gap-1.5">
              <ImageIcon className="h-3 w-3 text-blue-400" />
              Image Prompt (untuk reference frame)
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => copy(`Image prompt #${index + 1}`, scene.image_prompt)}
            >
              {copiedField === `Image prompt #${index + 1}` ? (
                <><Check className="h-3 w-3" /> Copied</>
              ) : (
                <><Copy className="h-3 w-3" /> Copy</>
              )}
            </Button>
          </div>
          <Textarea
            value={scene.image_prompt}
            onChange={e => onUpdate({ image_prompt: e.target.value })}
            rows={3}
            className="text-xs font-mono"
          />
        </div>

        {/* Video Prompt */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs flex items-center gap-1.5">
              <Film className="h-3 w-3 text-primary" />
              Video Prompt (ini yang dipakai Veo)
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => copy(`Video prompt #${index + 1}`, scene.video_prompt)}
            >
              {copiedField === `Video prompt #${index + 1}` ? (
                <><Check className="h-3 w-3" /> Copied</>
              ) : (
                <><Copy className="h-3 w-3" /> Copy</>
              )}
            </Button>
          </div>
          <Textarea
            value={scene.video_prompt}
            onChange={e => onUpdate({ video_prompt: e.target.value })}
            rows={3}
            className="text-xs font-mono"
          />
        </div>
      </CardContent>
    </Card>
  )
}
