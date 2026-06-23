import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, CheckCircle2, AlertCircle, Clock, Image as ImageIcon,
  Film, Wand2, Package, Youtube, Download, RotateCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, getToken } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { VeoProject, VeoScene, YoutubeAccount } from '@/lib/types'

function sceneState(s: VeoScene): { label: string; color: string; icon: typeof CheckCircle2 } {
  if (s.status === 'error') return { label: 'Error', color: 'text-red-400', icon: AlertCircle }
  if (s.status === 'done') return { label: 'Selesai', color: 'text-emerald-400', icon: CheckCircle2 }
  if (s.status === 'processing') return { label: 'Proses', color: 'text-blue-400', icon: Loader2 }
  return { label: 'Antri', color: 'text-muted-foreground', icon: Clock }
}

export function FacelessProjectPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['faceless-project', id],
    queryFn: () => api.get<{ project: VeoProject }>(`/api/veo/projects/${id}`),
    refetchInterval: 4000,
    enabled: !!id,
  })
  const project = data?.project
  const scenes = project?.scenes ?? []

  const doneCount = scenes.filter((s) => s.status === 'done').length
  const errorCount = scenes.filter((s) => s.status === 'error').length
  const narrCount = scenes.filter((s) => (s.narrationDuration ?? 0) > 0).length
  const allDone = scenes.length > 0 && doneCount === scenes.length
  // Scenes still waiting for a visual. NOTE: image-only modes (Ken Burns/static) go
  // queued→done directly (never 'processing'), so 'queued' here usually means
  // "still generating", NOT failed.
  const pendingCount = scenes.filter((s) => s.status === 'queued' && !s.firstImagePath && !s.videoUrl).length
  // Treat the project as actively generating unless nothing has updated for a while.
  const lastUpdateMs = Math.max(0, ...scenes.map((s) => Date.parse(s.updatedAt) || 0))
  const stale = scenes.length > 0 && Date.now() - lastUpdateMs > 180_000 // 3 min no progress
  const generating = pendingCount > 0 && !stale
  // Retry only for genuinely failed scenes, or pending ones that have clearly stalled —
  // never while a generation pool is actively running (avoids double-generation).
  const needsRetry = errorCount > 0 || (pendingCount > 0 && stale)
  const retryCount = scenes.filter((s) => s.status === 'error' || (s.status === 'queued' && !s.firstImagePath && !s.videoUrl)).length
  const assembleStatus = project?.assembleStatus ?? 'idle'
  const rendering = assembleStatus === 'queued' || assembleStatus === 'rendering'

  const [captions, setCaptions] = useState(false)

  const assembleMutation = useMutation({
    mutationFn: () => api.post(`/api/veo/projects/${id}/assemble`, { captions }),
    onSuccess: () => {
      toast.success('Mulai merakit jadi 1 video...')
      qc.invalidateQueries({ queryKey: ['faceless-project', id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const retryMutation = useMutation({
    mutationFn: () => api.post<{ retried: number }>(`/api/veo/projects/${id}/retry-failed`, {}),
    onSuccess: (r) => {
      toast.success(`Retry ${r.retried} scene yang gagal...`)
      qc.invalidateQueries({ queryKey: ['faceless-project', id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!project) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center gap-3">
        <Button asChild size="icon" variant="ghost" className="h-9 w-9">
          <Link to="/faceless"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold truncate flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary shrink-0" /> {project.title}
          </h1>
          <p className="text-xs text-muted-foreground">
            {scenes.length} scene · {doneCount} selesai · {narrCount} narasi{errorCount > 0 ? ` · ${errorCount} error` : ''}
          </p>
        </div>
      </div>

      {/* Actively generating (image-only modes have no 'processing' status) */}
      {generating && !needsRetry && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-blue-400 shrink-0 animate-spin" />
            <div className="text-sm">
              <p className="font-medium text-blue-300">Lagi generate {pendingCount} scene...</p>
              <p className="text-xs text-muted-foreground">Mode gambar nggak nampilin status "proses" — tunggu aja, angka "selesai" naik terus (di-throttle 4 paralel).</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Retry genuinely failed / stalled scenes */}
      {needsRetry && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
              <p className="font-medium text-amber-300">{retryCount} scene gagal / nyangkut</p>
              <p className="text-xs text-muted-foreground">Biasanya GeminiGen lagi sibuk (transient). Coba retry — scene yang sudah selesai tidak diulang.</p>
            </div>
            <Button size="sm" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
              {retryMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Retry...</> : <><RotateCw className="h-4 w-4" /> Retry {retryCount} scene</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Assemble / final video */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4 text-primary" /> Rakit Final Video</CardTitle>
          <CardDescription>
            {allDone ? 'Semua scene selesai — siap dirakit.' : `Menunggu ${scenes.length - doneCount} scene lagi selesai...`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => assembleMutation.mutate()} disabled={rendering || assembleMutation.isPending || doneCount === 0}>
              {rendering ? <><Loader2 className="h-4 w-4 animate-spin" /> Merakit...</> : <><Package className="h-4 w-4" /> Rakit jadi 1 video</>}
            </Button>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={captions} onCheckedChange={setCaptions} />
              Subtitle (bakar narasi)
            </label>
            {!allDone && doneCount > 0 && (
              <span className="text-xs text-amber-400">Bisa dirakit sebagian ({doneCount} scene done)</span>
            )}
          </div>

          {assembleStatus === 'error' && (
            <div className="text-sm text-red-400 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {project.assembleError || 'Gagal merakit'}
            </div>
          )}

          {assembleStatus === 'done' && <FinalVideo projectId={project.id} />}
        </CardContent>
      </Card>

      {/* Upload */}
      {assembleStatus === 'done' && <UploadCard projectId={project.id} defaultTitle={project.title} />}

      {/* Scenes grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {scenes.map((s) => {
          const st = sceneState(s)
          return (
            <Card key={s.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">Scene {s.sceneNumber}</span>
                  <span className={cn('text-xs inline-flex items-center gap-1', st.color)}>
                    <st.icon className={cn('h-3.5 w-3.5', s.status === 'processing' && 'animate-spin')} /> {st.label}
                  </span>
                </div>
                <div className="aspect-video rounded bg-muted/40 overflow-hidden flex items-center justify-center">
                  {s.firstImagePath ? (
                    <ScenedImg sceneId={s.id} />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{s.narrationText || s.prompt}</p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className={cn('inline-flex items-center gap-1', s.firstImagePath && 'text-emerald-400')}><ImageIcon className="h-3 w-3" /> img</span>
                  <span className={cn('inline-flex items-center gap-1', s.videoUrl && 'text-emerald-400')}><Film className="h-3 w-3" /> vid</span>
                  <span className={cn('inline-flex items-center gap-1', (s.narrationDuration ?? 0) > 0 && 'text-emerald-400')}>
                    🔊 {(s.narrationDuration ?? 0) > 0 ? `${s.narrationDuration!.toFixed(1)}s` : '—'}
                  </span>
                </div>
                {s.errorMsg && <p className="text-[11px] text-red-400 line-clamp-2">{s.errorMsg}</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// scene preview image (JWT-gated → fetch as blob)
function ScenedImg({ sceneId }: { sceneId: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoke: string | null = null
    fetch(`/api/veo/scenes/${sceneId}/image/first`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { revoke = URL.createObjectURL(b); setUrl(revoke) })
      .catch(() => {})
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [sceneId])
  return url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
}

// final video (JWT-gated → fetch as blob for inline player + download)
function FinalVideo({ projectId }: { projectId: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let revoke: string | null = null
    setLoading(true)
    fetch(`/api/veo/projects/${projectId}/final-video`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { revoke = URL.createObjectURL(b); setUrl(revoke) })
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [projectId])

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat video...</div>
  if (!url) return <p className="text-sm text-red-400">Gagal memuat video final</p>
  return (
    <div className="space-y-2">
      <video src={url} controls className="w-full rounded-lg bg-black max-h-[60vh]" />
      <Button asChild size="sm" variant="outline">
        <a href={url} download={`faceless_${projectId}.mp4`}><Download className="h-4 w-4" /> Download MP4</a>
      </Button>
    </div>
  )
}

const LANGUAGES = [
  { value: 'en', label: 'English' }, { value: 'id', label: 'Indonesian' },
  { value: 'es', label: 'Spanish' }, { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' }, { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' }, { value: 'ko', label: 'Korean' },
]

function UploadCard({ projectId, defaultTitle }: { projectId: number; defaultTitle: string }) {
  const [accountId, setAccountId] = useState<string>('')
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [privacy, setPrivacy] = useState<'public' | 'private' | 'unlisted'>('private')
  const [categoryId, setCategoryId] = useState('22')
  const [language, setLanguage] = useState('en')
  const [madeForKids, setMadeForKids] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [thumbFile, setThumbFile] = useState<File | null>(null)

  const { data } = useQuery({
    queryKey: ['youtube-accounts'],
    queryFn: () => api.get<{ accounts: YoutubeAccount[] }>('/api/youtube-accounts'),
  })
  const accounts = data?.accounts ?? []

  const { data: catData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ categories: { id: string; label: string }[] }>('/api/meta/categories'),
  })
  const categories = catData?.categories ?? []

  const uploadMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('youtubeAccountId', accountId)
      fd.append('title', title.trim())
      fd.append('description', description)
      fd.append('tags', tags)
      fd.append('privacy', privacy)
      fd.append('category_id', categoryId)
      fd.append('language', language)
      fd.append('made_for_kids', String(madeForKids))
      if (scheduledAt) fd.append('scheduled_at', new Date(scheduledAt).toISOString())
      if (thumbFile) fd.append('thumbnail', thumbFile)
      return api.post(`/api/veo/faceless/${projectId}/upload`, fd)
    },
    onSuccess: () => toast.success(scheduledAt ? 'Terjadwal — lihat di menu Upload' : 'Masuk antrian upload YouTube — pantau di menu Upload'),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Youtube className="h-4 w-4 text-red-500" /> Upload ke YouTube</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada channel terhubung. <Link to="/settings" className="text-primary underline">Hubungkan dulu</Link>.</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Pilih channel" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.channelTitle || a.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Privasi</Label>
                <Select value={privacy} onValueChange={(v) => setPrivacy(v as typeof privacy)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="unlisted">Unlisted</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Judul</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label>Deskripsi</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Tags (pisah koma)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fakta, luar angkasa" />
              <p className="text-xs text-muted-foreground">Tags bahasa Inggris buat targeting US.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Kategori</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.length === 0
                      ? <SelectItem value="22">People & Blogs</SelectItem>
                      : categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Bahasa Video</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Thumbnail (opsional)</Label>
              <div className="flex items-center gap-2">
                <input type="file" accept="image/*" onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)}
                  className="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
                {thumbFile && <span className="text-[11px] text-emerald-400 truncate">🖼 {thumbFile.name}</span>}
              </div>
              <p className="text-xs text-muted-foreground">Generate sendiri, upload di sini. Kalau kosong pakai thumbnail default YouTube.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Jadwal Publish (opsional)</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              <p className="text-xs text-muted-foreground">Kosongkan untuk upload langsung.</p>
            </div>
            <label className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <span className="text-sm">Made for Kids</span>
                <p className="text-xs text-muted-foreground">Konten ditujukan untuk anak-anak</p>
              </div>
              <Switch checked={madeForKids} onCheckedChange={setMadeForKids} />
            </label>
            <Button onClick={() => uploadMutation.mutate()} disabled={!accountId || !title.trim() || uploadMutation.isPending}>
              {uploadMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim...</> : <><Youtube className="h-4 w-4" /> {scheduledAt ? 'Jadwalkan' : 'Upload'}</>}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
