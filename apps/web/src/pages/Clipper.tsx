import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Scissors, Loader2, Download, Trash2, FileVideo, Clock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, getToken } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Clip { id: number; title: string; startSec: number; endSec: number; reason: string; status: string; error?: string | null }
interface Job { id: number; title: string; status: string; error?: string | null; clipCount: number; aspectRatio: string; createdAt: string; clips: Clip[] }

const RUNNING = ['queued', 'transcribing', 'selecting', 'rendering']
const STATUS_LABEL: Record<string, string> = {
  queued: 'Antri', transcribing: 'Transkrip audio...', selecting: 'AI pilih klip...',
  rendering: 'Merender klip...', done: 'Selesai', error: 'Error',
}

function fmtT(sec: number) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, '0')}` }

export function ClipperPage() {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [video, setVideo] = useState<File | null>(null)
  const [requirements, setRequirements] = useState('')
  const [count, setCount] = useState('3')
  const [aspectRatio, setAspectRatio] = useState('9:16')

  const { data } = useQuery({
    queryKey: ['clip-jobs'],
    queryFn: () => api.get<{ jobs: Job[] }>('/api/clipper/jobs'),
    refetchInterval: (q) => (q.state.data?.jobs?.some((j) => RUNNING.includes(j.status)) ? 4000 : false),
  })
  const jobs = data?.jobs ?? []

  const create = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('video', video!)
      if (title.trim()) fd.append('title', title.trim())
      fd.append('requirements', requirements)
      fd.append('count', count)
      fd.append('aspectRatio', aspectRatio)
      return api.post<{ jobId: number }>('/api/clipper/jobs', fd)
    },
    onSuccess: () => {
      toast.success('Video diupload — AI mulai bikin klip. Bisa makan beberapa menit.')
      setVideo(null); setTitle('')
      qc.invalidateQueries({ queryKey: ['clip-jobs'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/clipper/jobs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clip-jobs'] }),
  })

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Scissors className="h-6 w-6 text-primary" /> Clipper
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload video panjang + tempel syarat campaign → AI pilih momen yang sesuai syarat & potong jadi klip vertikal + caption otomatis.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buat Klip Baru</CardTitle>
          <CardDescription>Butuh Gemini API key (Settings). Video panjang = proses lebih lama.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Judul (opsional)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Misal: Podcast X - Episode 12" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label>Video sumber</Label>
              <input type="file" accept="video/*" onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
                className="text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary w-full" />
              {video && <span className="text-xs text-emerald-400 truncate block">🎬 {video.name}</span>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Syarat campaign (aturan yang harus dipenuhi klip)</Label>
            <Textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} rows={5}
              placeholder={'Tempel aturan campaign di sini. Contoh:\n- Durasi 30-60 detik\n- Wajib ada hook kuat di 3 detik pertama\n- Harus menyebut brand X\n- Momen paling emosional / kontroversial'} className="text-sm" />
            <p className="text-xs text-muted-foreground">Beda tiap campaign — tinggal ganti isinya. Kosongin kalau cuma mau momen paling viral.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Jumlah klip</Label>
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <SelectItem key={n} value={String(n)}>{n} klip</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rasio</Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16 (Shorts/TikTok)</SelectItem>
                  <SelectItem value="16:9">16:9 (landscape)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={() => create.mutate()} disabled={!video || create.isPending}>
            {create.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengupload...</> : <><Scissors className="h-4 w-4" /> Buat klip</>}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {jobs.map((job) => (
          <Card key={job.id}>
            <CardHeader className="flex-row items-start justify-between space-y-0 gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base truncate flex items-center gap-2">
                  <FileVideo className="h-4 w-4 text-primary shrink-0" /> {job.title}
                </CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  <StatusBadge status={job.status} />
                  <span>{job.aspectRatio} · {job.clips.length}/{job.clipCount} klip</span>
                </CardDescription>
                {job.status === 'error' && <p className="text-xs text-red-400 mt-1">{job.error}</p>}
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:bg-red-500/10 shrink-0" onClick={() => del.mutate(job.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            {job.clips.length > 0 && (
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {job.clips.map((c) => <ClipView key={c.id} clip={c} vertical={job.aspectRatio === '9:16'} />)}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
        {jobs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Belum ada klip. Upload video di atas buat mulai.</p>}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const running = RUNNING.includes(status)
  const Icon = status === 'done' ? CheckCircle2 : status === 'error' ? AlertCircle : running ? Loader2 : Clock
  const color = status === 'done' ? 'text-emerald-400' : status === 'error' ? 'text-red-400' : 'text-blue-400'
  return (
    <span className={cn('inline-flex items-center gap-1', color)}>
      <Icon className={cn('h-3.5 w-3.5', running && 'animate-spin')} /> {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function ClipView({ clip, vertical }: { clip: Clip; vertical: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (clip.status !== 'done') return
    let revoke: string | null = null
    fetch(`/api/clipper/clips/${clip.id}/video`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { revoke = URL.createObjectURL(b); setUrl(revoke) })
      .catch(() => {})
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [clip.id, clip.status])
  return (
    <div className="rounded-lg border p-2 space-y-1.5">
      <p className="text-xs font-medium line-clamp-2">{clip.title || 'Clip'}</p>
      <p className="text-[10px] text-muted-foreground">{fmtT(clip.startSec)}–{fmtT(clip.endSec)} · {Math.round(clip.endSec - clip.startSec)} dtk</p>
      {clip.reason && <p className="text-[10px] text-muted-foreground line-clamp-2 italic">{clip.reason}</p>}
      {clip.status === 'rendering' && <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Merender...</div>}
      {clip.status === 'error' && <p className="text-xs text-red-400">{clip.error || 'Gagal'}</p>}
      {clip.status === 'done' && url && (
        <>
          <video src={url} controls className={cn('w-full rounded bg-black', vertical ? 'aspect-[9/16] max-h-[50vh]' : 'aspect-video')} />
          <Button asChild size="sm" variant="outline" className="w-full"><a href={url} download={`clip_${clip.id}.mp4`}><Download className="h-3.5 w-3.5" /> Download</a></Button>
        </>
      )}
    </div>
  )
}
