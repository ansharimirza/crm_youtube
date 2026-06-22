import { useState, useMemo, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

type Mode = 'veo' | 'kenburns' | 'static'
type VoiceMode = 'tts' | 'single' | 'upload'
type Aspect = '16:9' | '9:16'

interface SceneRow {
  image_prompt: string   // STATE 8
  narration_text: string // STATE 6 (voice script)
  video_prompt: string   // STATE 9 (optional)
  audioFile: File | null  // own-voice upload (voiceMode='upload')
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

// STATE-8/9 beats embed a spoken hook before the visual:
//   B1 — "hook quote"  Prompt: <visual>  Camera: ...        (STATE 8)
//   B1 — "hook quote" → <motion> ~4s                         (STATE 9)
// Keep only the description: drop the hook, strip the "Prompt:" label / "→",
// drop markdown bold, collapse to one line. Safe no-op if neither marker present.
function cleanPrompt(s: string): string {
  let t = s.replace(/\*\*/g, '')
  const m = t.match(/\bPrompt\s*:\s*/i)
  if (m && m.index !== undefined) t = t.slice(m.index + m[0].length)
  else if (t.includes('→')) t = t.slice(t.indexOf('→') + 1)
  return t.replace(/\s+/g, ' ').trim()
}

// Beat marker at line start: "1." "2)" "Scene 3:" "B1 —" "Beat 5:". The separator
// after the number is "any 1–3 punctuation/symbol chars" so it tolerates em/en dashes
// AND mojibake dashes (e.g. "â€"" from a mis-encoded .md). Leading markdown bold
// (**B1**) is stripped beforehand. A separator is required, so "10 people..." won't match.
const BEAT_MARKER = /^\s*(?:scene|beat|b)?\s*#?\s*\d+\s*[^\w\s]{1,3}\s*/i

// Split STATE 8 into per-beat { image, narration }. Each beat looks like:
//   B1 — "spoken hook quote"   Prompt: <visual>   Camera: ... Lighting: ...
// narration = the hook quote (used for subtitle + duration weighting), image = the Prompt: part.
function parseState8(text: string): { image: string; narration: string }[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\*\*/g, '') // drop markdown bold
  if (!raw.trim()) return []
  const lines = raw.split('\n')
  if (!lines.some((l) => BEAT_MARKER.test(l))) return []
  const blocks: string[] = []
  let cur: string[] = []
  let started = false
  for (const line of lines) {
    if (BEAT_MARKER.test(line)) {
      if (started) blocks.push(cur.join('\n'))
      cur = [line.replace(BEAT_MARKER, '')]
      started = true
    } else if (started) cur.push(line)
  }
  if (started) blocks.push(cur.join('\n'))
  return blocks
    .map((b) => {
      const m = b.match(/\bPrompt\s*:\s*/i)
      let narration = ''
      let image = b
      if (m && m.index !== undefined) {
        narration = b.slice(0, m.index)
        image = b.slice(m.index + m[0].length)
      }
      image = image.replace(/\s+/g, ' ').trim()
      narration = narration.replace(/[""„"]/g, '').replace(/\s+/g, ' ').trim()
      return { image, narration }
    })
    .filter((x) => x.image)
}

// Split a STATE list into items. Primary: a beat marker at line start.
// Fallbacks: blank-line paragraphs, then per-line.
// clean=true extracts the "Prompt:" / "→" portion of each item.
function parseList(text: string, clean = false): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\*\*/g, '')
  if (!raw.trim()) return []
  const marker = BEAT_MARKER
  const out = (items: string[]) => items.map((x) => (clean ? cleanPrompt(x) : x.trim())).filter(Boolean)
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
    return out(items.filter(Boolean))
  }
  // No markers → blank-line paragraphs
  const paras = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paras.length > 1) return out(paras)
  // Single block → one per non-empty line
  return out(raw.split('\n').map((l) => l.trim()).filter(Boolean))
}

export function FacelessStudioPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<Mode>('veo')
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('tts')
  const [aspect, setAspect] = useState<Aspect>('16:9')
  const [voice, setVoice] = useState('Charon')
  const [fullAudio, setFullAudio] = useState<File | null>(null) // voiceMode='single'
  const [submitting, setSubmitting] = useState(false)
  const [scenes, setScenes] = useState<SceneRow[]>([{ image_prompt: '', narration_text: '', video_prompt: '', audioFile: null }])

  // bulk paste buffers (narration is auto-derived from STATE 8 hook quotes)
  const [bulkImg, setBulkImg] = useState('')
  const [bulkVid, setBulkVid] = useState('')
  const [showBulk, setShowBulk] = useState(true)

  const { data } = useQuery({
    queryKey: ['veo-projects'],
    queryFn: () => api.get<{ projects: VeoProjectSummary[] }>('/api/veo/projects'),
    refetchInterval: 5000,
  })
  const projects = data?.projects ?? []

  // A scene is "ready" when it has an image prompt + its voice source:
  //  tts: narration text · upload: per-scene audio file · single: image only (audio is project-level)
  const validScenes = useMemo(
    () =>
      scenes.filter((s) => {
        if (!s.image_prompt.trim()) return false
        if (voiceMode === 'tts') return !!s.narration_text.trim()
        if (voiceMode === 'upload') return !!s.audioFile
        return true // single
      }),
    [scenes, voiceMode],
  )

  function applyBulk() {
    // STATE 8 yields image + (auto) narration per beat. Fall back to a plain list if no beats.
    const beats = parseState8(bulkImg)
    const imgs = beats.length ? beats.map((b) => b.image) : parseList(bulkImg, true)
    const narrs = beats.length ? beats.map((b) => b.narration) : []
    const vids = parseList(bulkVid, true)
    const n = imgs.length
    if (n === 0) {
      toast.error('Tempel/upload STATE 8 (Image Prompt) dulu')
      return
    }
    const rows: SceneRow[] = []
    for (let i = 0; i < n; i++) {
      rows.push({
        image_prompt: imgs[i] ?? '',
        narration_text: narrs[i] ?? '',
        video_prompt: vids[i] ?? '',
        audioFile: null,
      })
    }
    setScenes(rows)
    setShowBulk(false)
    const withNarr = narrs.filter(Boolean).length
    toast.success(`${n} scene di-parse${withNarr ? ` (${withNarr} ada narasi)` : ''}. Cek lalu Generate.`)
  }

  function updateScene(i: number, patch: Partial<SceneRow>) {
    setScenes((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addScene() {
    setScenes((prev) => [...prev, { image_prompt: '', narration_text: '', video_prompt: '', audioFile: null }])
  }
  function removeScene(i: number) {
    setScenes((prev) => prev.filter((_, idx) => idx !== i))
  }

  // Load a downloaded .md/.txt straight into a STATE box (no copy-paste needed).
  async function loadFile(e: ChangeEvent<HTMLInputElement>, setter: (v: string) => void) {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-picking same file
    if (!f) return
    const text = await f.text()
    setter(text)
    toast.success(`${f.name} dimuat`)
  }

  async function submit() {
    if (!title.trim()) return toast.error('Isi judul project')
    if (validScenes.length === 0) {
      const why = voiceMode === 'tts' ? 'image prompt + narasi' : voiceMode === 'upload' ? 'image prompt + file audio' : 'image prompt'
      return toast.error(`Minimal 1 scene dengan ${why}`)
    }
    if (voiceMode === 'single' && !fullAudio) return toast.error('Upload 1 file narasi penuh dulu')
    setSubmitting(true)
    try {
      const res = await api.post<{ projectId: number; sceneIds: number[]; sceneCount: number }>('/api/veo/faceless', {
        title: title.trim(),
        mode,
        aspectRatio: aspect,
        voiceMode,
        ...(voiceMode === 'tts' ? { voice } : {}),
        scenes: validScenes.map((s) => ({
          image_prompt: s.image_prompt.trim(),
          ...(s.narration_text.trim() ? { narration_text: s.narration_text.trim() } : {}),
          ...(s.video_prompt.trim() ? { video_prompt: s.video_prompt.trim() } : {}),
        })),
      })

      // Upload-voice (per scene): push each scene's audio to its new scene id (same order).
      if (voiceMode === 'upload') {
        for (let i = 0; i < validScenes.length; i++) {
          const file = validScenes[i].audioFile
          const sceneId = res.sceneIds[i]
          if (!file || !sceneId) continue
          const fd = new FormData()
          fd.append('audio', file)
          await api.post(`/api/veo/scenes/${sceneId}/narration-audio`, fd)
        }
      }

      // Single full narration: one file for the whole project.
      if (voiceMode === 'single' && fullAudio) {
        const fd = new FormData()
        fd.append('audio', fullAudio)
        await api.post(`/api/veo/projects/${res.projectId}/narration-full`, fd)
      }

      toast.success(`Project dibuat — ${res.sceneCount} scene mulai digenerate`)
      qc.invalidateQueries({ queryKey: ['veo-projects'] })
      navigate(`/faceless/${res.projectId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat project')
    } finally {
      setSubmitting(false)
    }
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
            <div className="space-y-1.5 lg:col-span-2">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="veo">Veo (sinematik, pakai kredit Veo)</SelectItem>
                  <SelectItem value="kenburns">Ken Burns (gambar + zoom, murah & cepat)</SelectItem>
                  <SelectItem value="static">Static (gambar diam, tanpa zoom)</SelectItem>
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
            <div className="space-y-1.5">
              <Label>Sumber Suara</Label>
              <Select value={voiceMode} onValueChange={(v) => setVoiceMode(v as VoiceMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tts">Gemini TTS (otomatis)</SelectItem>
                  <SelectItem value="single">Upload 1 narasi penuh</SelectItem>
                  <SelectItem value="upload">Upload audio per scene</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {voiceMode === 'tts' && (
              <div className="space-y-1.5 lg:col-span-4">
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
            )}
            {voiceMode === 'single' && (
              <div className="space-y-1.5 lg:col-span-4">
                <Label>File narasi penuh (1 audio untuk seluruh video)</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setFullAudio(e.target.files?.[0] ?? null)}
                    className="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary"
                  />
                  {fullAudio && <span className="text-[11px] text-emerald-400 truncate">🔊 {fullAudio.name}</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Durasi tiap gambar dibagi otomatis mengikuti panjang audio — ditimbang dari panjang teks narasi per-scene (kalau diisi), atau dibagi rata. Teks narasi opsional (buat subtitle).
                </p>
              </div>
            )}
            {voiceMode === 'upload' && (
              <p className="text-xs text-muted-foreground lg:col-span-4">
                Mode per-scene: tiap scene unggah file audio (.mp3/.wav/.m4a) sendiri. Durasi tiap klip otomatis menyesuaikan panjang audionya. Teks narasi opsional (buat subtitle).
              </p>
            )}
          </div>

          {/* Bulk paste */}
          <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.03]">
            <button
              type="button"
              onClick={() => setShowBulk((s) => !s)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium"
            >
              <ClipboardPaste className="h-4 w-4 text-primary" />
              Tempel Massal (STATE 8 + STATE 9)
              <ChevronRight className={cn('h-4 w-4 ml-auto transition-transform', showBulk && 'rotate-90')} />
            </button>
            {showBulk && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Tempel, atau <b>upload file .md/.txt</b> hasil unduhan dari claude.ai. Narasi per-scene <b>otomatis diambil dari kutipan di STATE 8</b> (tiap <code>B1 — "..."</code>) — jadi STATE 6 nggak perlu.
                </p>
                <div className="grid lg:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs">STATE 8 — Image Prompt <span className="text-muted-foreground">(+ narasi otomatis)</span></Label>
                      <label className="text-[11px] text-primary cursor-pointer hover:underline shrink-0">
                        ⬆ file<input type="file" accept=".md,.txt,text/*" className="hidden" onChange={(e) => loadFile(e, setBulkImg)} />
                      </label>
                    </div>
                    <Textarea value={bulkImg} onChange={(e) => setBulkImg(e.target.value)} rows={8} placeholder={'Tempel STATE 8, atau ⬆ file.\nB1 — "..." Prompt: a wide shot of...'} className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs">STATE 9 — Video Prompt <span className="text-muted-foreground">(opsional, cuma mode Veo)</span></Label>
                      <label className="text-[11px] text-primary cursor-pointer hover:underline shrink-0">
                        ⬆ file<input type="file" accept=".md,.txt,text/*" className="hidden" onChange={(e) => loadFile(e, setBulkVid)} />
                      </label>
                    </div>
                    <Textarea value={bulkVid} onChange={(e) => setBulkVid(e.target.value)} rows={8} placeholder={'Cuma untuk mode Veo. Tempel STATE 9, atau ⬆ file.'} className="font-mono text-xs" />
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
                    <Textarea value={s.narration_text} onChange={(e) => updateScene(i, { narration_text: e.target.value })} rows={2} placeholder={voiceMode === 'upload' ? 'Narasi/subtitle (opsional)' : 'Narasi (STATE 6)'} className="text-xs" />
                    {mode === 'veo' && (
                      <Textarea value={s.video_prompt} onChange={(e) => updateScene(i, { video_prompt: e.target.value })} rows={2} placeholder="Video prompt (STATE 9, opsional)" className="text-xs" />
                    )}
                  </div>
                  {voiceMode === 'upload' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => updateScene(i, { audioFile: e.target.files?.[0] ?? null })}
                        className="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-primary"
                      />
                      {s.audioFile && <span className="text-[11px] text-emerald-400 truncate">🔊 {s.audioFile.name}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={submit} disabled={submitting || validScenes.length === 0}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> {voiceMode === 'tts' ? 'Membuat...' : 'Upload audio...'}</> : <><Wand2 className="h-4 w-4" /> Generate {validScenes.length} Scene</>}
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
