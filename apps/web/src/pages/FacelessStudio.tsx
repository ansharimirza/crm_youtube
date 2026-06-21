import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Wand2, Plus, Trash2, Loader2, KeyRound, ClipboardPaste, Film,
  CheckCircle2, AlertCircle, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth'
import type { VeoProjectSummary } from '@/lib/types'

type Mode = 'veo' | 'kenburns'
type Aspect = '16:9' | '9:16'

interface SceneRow {
  image_prompt: string   // STATE 8
  narration_text: string // STATE 6 (voice script)
  video_prompt: string   // STATE 9 (optional)
}

const VOICES = [
  { v: 'Kore', d: 'Netral / tegas' },
  { v: 'Puck', d: 'Ceria / upbeat' },
  { v: 'Charon', d: 'Dalam / informatif' },
  { v: 'Aoede', d: 'Santai' },
  { v: 'Leda', d: 'Muda' },
  { v: 'Fenrir', d: 'Bersemangat' },
  { v: 'Orus', d: 'Tegas' },
  { v: 'Zephyr', d: 'Cerah' },
]

// Split a STATE list into items. Primary: numbered list ("1." "2)" "Scene 3:" "#4").
// Fallbacks: blank-line-separated paragraphs, then one-per-line.
function parseList(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n')
  if (!raw.trim()) return []
  const marker = /^\s*(?:scene\s*)?#?\s*\d+\s*[.):\-—]\s?/i
  const lines = raw.split('\n')
  const hasMarkers = lines.some((l) => marker.test(l))
  if (hasMarkers) {
    const items: string[] = []
    let cur: string[] = []
    let started = false
    for (const line of lines) {
      if (marker.test(line)) {
        if (started) items.push(cur.join('\n').trim())
        cur = [line.replace(marker, '')]
        started = true
      } else if (started) {
        cur.push(line)
      }
    }
    if (started) items.push(cur.join('\n').trim())
    return items.filter(Boolean)
  }
  // No numbers → blank-line paragraphs
  const paras = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paras.length > 1) return paras
  // Single block → one per non-empty line
  return raw.split('\n').map((l) => l.trim()).filter(Boolean)
}

export function FacelessStudioPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<Mode>('veo')
  const [aspect, setAspect] = useState<Aspect>('16:9')
  const [voice, setVoice] = useState('Charon')
  const [scenes, setScenes] = useState<SceneRow[]>([{ image_prompt: '', narration_text: '', video_prompt: '' }])

  // bulk paste buffers
  const [bulkImg, setBulkImg] = useState('')
  const [bulkNarr, setBulkNarr] = useState('')
  const [bulkVid, setBulkVid] = useState('')
  const [showBulk, setShowBulk] = useState(true)

  const { data } = useQuery({
    queryKey: ['veo-projects'],
    queryFn: () => api.get<{ projects: VeoProjectSummary[] }>('/api/veo/projects'),
    refetchInterval: 5000,
  })
  const projects = data?.projects ?? []

  const validScenes = useMemo(
    () => scenes.filter((s) => s.image_prompt.trim() && s.narration_text.trim()),
    [scenes],
  )

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post<{ projectId: number; sceneCount: number }>('/api/veo/faceless', payload),
    onSuccess: (res) => {
      toast.success(`Project dibuat — ${res.sceneCount} scene mulai digenerate`)
      qc.invalidateQueries({ queryKey: ['veo-projects'] })
      navigate(`/faceless/${res.projectId}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function applyBulk() {
    const imgs = parseList(bulkImg)
    const narrs = parseList(bulkNarr)
    const vids = parseList(bulkVid)
    const n = Math.max(imgs.length, narrs.length)
    if (n === 0) {
      toast.error('Tempel minimal Image Prompt (STATE 8) dan Narasi (STATE 6)')
      return
    }
    if (imgs.length !== narrs.length) {
      toast.warning(`Jumlah beda: ${imgs.length} image vs ${narrs.length} narasi. Cek penomoran tiap baris.`)
    }
    const rows: SceneRow[] = []
    for (let i = 0; i < n; i++) {
      rows.push({
        image_prompt: imgs[i] ?? '',
        narration_text: narrs[i] ?? '',
        video_prompt: vids[i] ?? '',
      })
    }
    setScenes(rows)
    setShowBulk(false)
    toast.success(`${n} scene di-parse. Cek lalu Generate.`)
  }

  function updateScene(i: number, patch: Partial<SceneRow>) {
    setScenes((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addScene() {
    setScenes((prev) => [...prev, { image_prompt: '', narration_text: '', video_prompt: '' }])
  }
  function removeScene(i: number) {
    setScenes((prev) => prev.filter((_, idx) => idx !== i))
  }

  function submit() {
    if (!title.trim()) return toast.error('Isi judul project')
    if (validScenes.length === 0) return toast.error('Minimal 1 scene dengan image prompt + narasi')
    createMutation.mutate({
      title: title.trim(),
      mode,
      aspectRatio: aspect,
      voice,
      scenes: validScenes.map((s) => ({
        image_prompt: s.image_prompt.trim(),
        narration_text: s.narration_text.trim(),
        ...(s.video_prompt.trim() ? { video_prompt: s.video_prompt.trim() } : {}),
      })),
    })
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-primary" />
          Faceless Studio
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tempel Image Prompt (STATE 8), Narasi/voice (STATE 6) & Video Prompt (STATE 9) → auto generate gambar + video + suara jadi 1 video.
        </p>
      </div>

      {!user?.hasGeminigenKey && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <KeyRound className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-amber-300">GeminiGen API Key belum diatur</p>
              <p className="text-muted-foreground text-xs mt-1">Atur dulu di Settings sebelum generate.</p>
              <Button asChild size="sm" className="mt-3"><Link to="/settings">Ke Settings →</Link></Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Baru</CardTitle>
          <CardDescription>1 baris = 1 scene. Narasi tiap scene ~≤18 kata biar pas 1 klip 8 detik.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Settings row */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5 lg:col-span-4">
              <Label>Judul</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Misal: 10 Fakta Luar Angkasa" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="veo">Veo (sinematik, pakai kredit Veo)</SelectItem>
                  <SelectItem value="kenburns">Ken Burns (gambar + zoom, murah & cepat)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rasio</Label>
              <Select value={aspect} onValueChange={(v) => setAspect(v as Aspect)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 (landscape)</SelectItem>
                  <SelectItem value="9:16">9:16 (shorts/reels)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label>Suara (Gemini TTS)</Label>
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VOICES.map((x) => (
                    <SelectItem key={x.v} value={x.v}>{x.v} — {x.d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bulk paste */}
          <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.03]">
            <button
              type="button"
              onClick={() => setShowBulk((s) => !s)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium"
            >
              <ClipboardPaste className="h-4 w-4 text-primary" />
              Tempel Massal (dari STATE 8 / 6 / 9)
              <ChevronRight className={cn('h-4 w-4 ml-auto transition-transform', showBulk && 'rotate-90')} />
            </button>
            {showBulk && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Tempel list bernomor dari tiap state. Scene dicocokkan urut nomor (image #1 ↔ narasi #1 ↔ video #1).
                </p>
                <div className="grid lg:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">STATE 8 — Image Prompt</Label>
                    <Textarea value={bulkImg} onChange={(e) => setBulkImg(e.target.value)} rows={8} placeholder={'1. a wide shot of...\n2. close up of...'} className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">STATE 6 — Narasi / Voice</Label>
                    <Textarea value={bulkNarr} onChange={(e) => setBulkNarr(e.target.value)} rows={8} placeholder={'1. Tahukah kamu...\n2. Ternyata...'} className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">STATE 9 — Video Prompt <span className="text-muted-foreground">(opsional)</span></Label>
                    <Textarea value={bulkVid} onChange={(e) => setBulkVid(e.target.value)} rows={8} placeholder={'1. slow pan left...\n2. zoom in...'} className="font-mono text-xs" />
                  </div>
                </div>
                <Button type="button" size="sm" onClick={applyBulk}>
                  <ClipboardPaste className="h-4 w-4" /> Parse jadi scene
                </Button>
              </div>
            )}
          </div>

          {/* Scene editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Scene ({validScenes.length} siap{scenes.length !== validScenes.length ? `, ${scenes.length - validScenes.length} kosong` : ''})</Label>
              <Button type="button" size="sm" variant="outline" onClick={addScene}>
                <Plus className="h-3.5 w-3.5" /> Tambah
              </Button>
            </div>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {scenes.map((s, i) => (
                <div key={i} className="rounded-lg border bg-card/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">Scene {i + 1}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:bg-red-500/10" onClick={() => removeScene(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid lg:grid-cols-3 gap-2">
                    <Textarea value={s.image_prompt} onChange={(e) => updateScene(i, { image_prompt: e.target.value })} rows={2} placeholder="Image prompt (STATE 8)" className="text-xs" />
                    <Textarea value={s.narration_text} onChange={(e) => updateScene(i, { narration_text: e.target.value })} rows={2} placeholder="Narasi (STATE 6)" className="text-xs" />
                    <Textarea value={s.video_prompt} onChange={(e) => updateScene(i, { video_prompt: e.target.value })} rows={2} placeholder="Video prompt (STATE 9, opsional)" className="text-xs" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={submit} disabled={createMutation.isPending || validScenes.length === 0}>
              {createMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Membuat...</> : <><Wand2 className="h-4 w-4" /> Generate {validScenes.length} Scene</>}
            </Button>
            {mode === 'veo' && validScenes.length > 0 && (
              <span className="text-xs text-muted-foreground">≈ {validScenes.length * 3} kredit Veo</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent projects */}
      {projects.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Project terakhir</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.slice(0, 9).map((p) => (
              <Link key={p.id} to={`/faceless/${p.id}`}>
                <Card className="hover:border-primary/40 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <Film className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium truncate">{p.title}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                      <span>{p.sceneCount} scene</span>
                      {p.doneCount > 0 && <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{p.doneCount}</span>}
                      {p.processingCount > 0 && <span className="text-blue-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{p.processingCount}</span>}
                      {p.errorCount > 0 && <span className="text-red-400 inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" />{p.errorCount}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground/60 mt-1">{formatRelativeTime(p.createdAt)}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
