import { useState, type FormEvent } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Film, Plus, ArrowLeft, Image as ImageIcon, X, Loader2, CheckCircle2,
  AlertCircle, Clock, Trash2, Download, ExternalLink, RotateCw, Play, Sparkles,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { VeoProject, VeoScene, VeoModel, VeoAspectRatio, VeoResolution } from '@/lib/types'

const MODELS: { value: VeoModel; label: string; desc: string }[] = [
  { value: 'veo-3.1',       label: 'Veo 3.1',       desc: 'Latest highest quality (8s, 720p/1080p)' },
  { value: 'veo-3.1-fast',  label: 'Veo 3.1 Fast',  desc: 'Lebih cepat (8s, 720p/1080p)' },
  { value: 'veo-3.1-lite',  label: 'Veo 3.1 Lite',  desc: 'Dengan audio sinkron' },
  { value: 'veo-2',         label: 'Veo 2',         desc: 'Flexible duration (4/6/8s), 720p only' },
]

export function VeoProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const { data, refetch } = useQuery({
    queryKey: ['veo-project', id],
    queryFn: () => api.get<{ project: VeoProject }>(`/api/veo/projects/${id}`),
    refetchInterval: 5000,
    enabled: !!id,
  })
  const project = data?.project

  const deleteSceneMutation = useMutation({
    mutationFn: (sceneId: number) => api.delete(`/api/veo/scenes/${sceneId}`),
    onSuccess: () => {
      toast.success('Scene dihapus')
      qc.invalidateQueries({ queryKey: ['veo-project', id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const retrySceneMutation = useMutation({
    mutationFn: (sceneId: number) => api.post(`/api/veo/scenes/${sceneId}/retry`),
    onSuccess: () => {
      toast.success('Scene di-retry')
      refetch()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!project) {
    return <div className="text-center py-20 text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/veo">
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Veo Studio
        </Link>
      </Button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Film className="h-6 w-6 text-primary" />
            {project.title}
          </h1>
          {project.description && (
            <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
          )}
          <div className="text-xs text-muted-foreground/70 mt-2">
            {project.scenes.length} scene • Dibuat {formatRelativeTime(project.createdAt)}
          </div>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" />
          {showForm ? 'Tutup Form' : 'Tambah Scene'}
        </Button>
      </div>

      {/* Add scene form */}
      {showForm && (
        <CreateSceneForm
          projectId={project.id}
          nextSceneNumber={project.scenes.length + 1}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['veo-project', id] })
            setShowForm(false)
          }}
        />
      )}

      {/* Scene list */}
      {project.scenes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Film className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">Belum ada scene</p>
            <Button onClick={() => setShowForm(true)} className="mt-4" size="sm">
              <Plus className="h-4 w-4" />
              Buat Scene Pertama
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {project.scenes.map(scene => (
            <SceneCard
              key={scene.id}
              scene={scene}
              onDelete={() => {
                if (confirm(`Hapus Scene ${scene.sceneNumber}?`)) {
                  deleteSceneMutation.mutate(scene.id)
                }
              }}
              onRetry={() => retrySceneMutation.mutate(scene.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CreateSceneForm({
  projectId, nextSceneNumber, onClose, onSuccess,
}: {
  projectId: number
  nextSceneNumber: number
  onClose: () => void
  onSuccess: () => void
}) {
  const [firstImage, setFirstImage] = useState<File | null>(null)
  const [lastImage, setLastImage] = useState<File | null>(null)
  const [firstPreview, setFirstPreview] = useState<string | null>(null)
  const [lastPreview, setLastPreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<VeoModel>('veo-2')
  const [aspectRatio, setAspectRatio] = useState<VeoAspectRatio>('16:9')
  const [resolution, setResolution] = useState<VeoResolution>('720p')
  const [duration, setDuration] = useState(4)

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      if (firstImage) fd.append('first_image', firstImage)
      if (lastImage) fd.append('last_image', lastImage)
      fd.append('prompt', prompt)
      fd.append('model', model)
      fd.append('resolution', resolution)
      fd.append('duration', String(duration))
      fd.append('aspect_ratio', aspectRatio)
      fd.append('mode_image', 'frame')

      const res = await fetch(`/api/veo/projects/${projectId}/scenes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('ytcrm_token')}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Scene di-queue, generate dimulai...')
      onSuccess()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function previewImage(file: File | null, setPreview: (v: string | null) => void) {
    if (!file) { setPreview(null); return }
    const reader = new FileReader()
    reader.onload = (e) => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleFirstImage(file: File | null) {
    setFirstImage(file)
    previewImage(file, setFirstPreview)
  }
  function handleLastImage(file: File | null) {
    setLastImage(file)
    previewImage(file, setLastPreview)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!prompt.trim()) {
      toast.error('Prompt wajib diisi')
      return
    }
    mutation.mutate()
  }

  // Auto-adjust duration constraints
  const durationOptions =
    model === 'veo-2'
      ? [4, 6, 8]
      : [8] // Veo 3.1 dan variants = fixed 8s

  const aspectRatioOptions: VeoAspectRatio[] =
    model === 'veo-2' ? ['16:9', '9:16'] : ['16:9']

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scene #{nextSceneNumber}</CardTitle>
        <CardDescription>Image references opsional, prompt wajib</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Image references */}
          <div className="space-y-2">
            <Label>Image References (opsional)</Label>
            <div className="grid grid-cols-2 gap-3">
              <ImagePicker
                label="First Image"
                preview={firstPreview}
                onChange={handleFirstImage}
              />
              <ImagePicker
                label="Last Image"
                preview={lastPreview}
                onChange={handleLastImage}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Frame awal & akhir video (mode: frame). Boleh isi salah satu saja, atau kosong.
            </p>
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="prompt">
              Prompt <span className="text-primary">*</span>
            </Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Misal: blue-gloved hands measuring a tangled strand of matted dog fur with a tape measure."
              rows={4}
              maxLength={4000}
              required
            />
            <div className="text-xs text-muted-foreground text-right">{prompt.length}/4000</div>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <Label>Model</Label>
            <Select value={model} onValueChange={v => {
              setModel(v as VeoModel)
              // Reset duration & aspect saat ganti model
              if (v !== 'veo-2') {
                setDuration(8)
                setAspectRatio('16:9')
              }
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODELS.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    <div>
                      <div className="font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground">{m.desc}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Aspect Ratio + Resolution + Duration */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Aspect Ratio</Label>
              <div className="grid grid-cols-2 gap-2">
                {aspectRatioOptions.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAspectRatio(r)}
                    className={cn(
                      'rounded-lg border p-3 text-sm font-medium transition-colors',
                      aspectRatio === r ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/30'
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Resolution</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['720p', '1080p'] as VeoResolution[]).map(r => {
                  const disabled = model === 'veo-2' && r === '1080p'
                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={disabled}
                      onClick={() => setResolution(r)}
                      className={cn(
                        'rounded-lg border p-3 text-sm font-medium transition-colors',
                        resolution === r ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/30',
                        disabled && 'opacity-40 cursor-not-allowed'
                      )}
                    >
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Duration</Label>
              <div className="grid grid-cols-3 gap-2">
                {durationOptions.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={cn(
                      'rounded-lg border p-3 text-sm font-medium transition-colors',
                      duration === d ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/30'
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Tips */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Kalau gagal, sistem otomatis hit ulang sampai berhasil (max 20x percobaan).
              Bisa generate hingga 5 scene bersamaan.
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Mengirim...' : 'Generate Scene'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function ImagePicker({ label, preview, onChange }: {
  label: string
  preview: string | null
  onChange: (file: File | null) => void
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {preview ? (
        <div className="relative rounded-lg border overflow-hidden aspect-video bg-muted">
          <img src={preview} alt="" className="w-full h-full object-cover" />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute top-1 right-1 h-6 w-6"
            onClick={() => onChange(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-2 aspect-video border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Pilih image</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
    </div>
  )
}

function SceneStatusBadge({ scene }: { scene: VeoScene }) {
  const config = {
    queued:     { variant: 'warning' as const, icon: Clock,        label: 'Antrian' },
    processing: { variant: 'info' as const,    icon: Loader2,      label: scene.progress > 0 ? `${scene.progress}%` : 'Processing' },
    done:       { variant: 'success' as const, icon: CheckCircle2, label: 'Selesai' },
    error:      { variant: 'destructive' as const, icon: AlertCircle, label: 'Error' },
  }[scene.status]

  const Icon = config.icon
  return (
    <Badge variant={config.variant}>
      <Icon className={cn('mr-1 h-3 w-3', scene.status === 'processing' && 'animate-spin')} />
      {config.label}
    </Badge>
  )
}

function SceneCard({ scene, onDelete, onRetry }: {
  scene: VeoScene
  onDelete: () => void
  onRetry: () => void
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid sm:grid-cols-[280px_1fr] gap-0">
          {/* Video / placeholder */}
          <div className="aspect-video bg-gradient-to-br from-primary/10 to-purple-500/10 sm:rounded-l-xl overflow-hidden">
            {scene.status === 'done' && scene.videoUrl ? (
              <video
                src={scene.videoUrl}
                controls
                poster={scene.thumbnailUrl ?? undefined}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                {scene.status === 'processing' && (
                  <>
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    <span className="text-xs text-muted-foreground">{scene.progress}%</span>
                  </>
                )}
                {scene.status === 'queued' && (
                  <>
                    <Clock className="h-8 w-8 text-amber-400" />
                    <span className="text-xs text-muted-foreground">Menunggu antrian...</span>
                  </>
                )}
                {scene.status === 'error' && (
                  <>
                    <AlertCircle className="h-8 w-8 text-red-400" />
                    <span className="text-xs text-muted-foreground">Generate gagal</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg">Scene #{scene.sceneNumber}</h3>
                <SceneStatusBadge scene={scene} />
                {scene.attempts > 1 && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    Attempt {scene.attempts}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {scene.status === 'done' && scene.videoUrl && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={scene.videoUrl} download target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                {scene.status === 'error' && (
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    <RotateCw className="h-4 w-4" />
                    Retry
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onDelete}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  title="Hapus"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <p className="text-sm text-muted-foreground line-clamp-3">{scene.prompt}</p>

            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <Badge variant="outline">{scene.model}</Badge>
              <span>{scene.aspectRatio}</span>
              <span>•</span>
              <span>{scene.resolution}</span>
              <span>•</span>
              <span>{scene.duration}s</span>
              {(scene.firstImagePath || scene.lastImagePath) && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    {(scene.firstImagePath ? 1 : 0) + (scene.lastImagePath ? 1 : 0)} ref
                  </span>
                </>
              )}
            </div>

            {scene.status === 'processing' && scene.progress > 0 && (
              <Progress value={scene.progress} className="h-1.5" />
            )}

            {scene.errorMsg && scene.status === 'error' && (
              <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">
                {scene.errorMsg}
              </div>
            )}

            {scene.status === 'processing' && scene.errorMsg && (
              <div className="text-xs text-amber-400 bg-amber-500/10 rounded p-2">
                ↻ {scene.errorMsg}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
