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
  startSec?: number       // timestamp mode ([m:ss] beat start) → per-scene timing on upload
}

// Timestamp-locked docs (e.g. image-prompt sheets): lines like "[0:04] <text>". Each is a
// beat whose bracket time is its start — used to time uploaded images without a voice script.
function parseTimestampBeats(text: string): { startSec: number; rest: string }[] {
  const out: { startSec: number; rest: string }[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\[\s*(\d+):(\d{1,2})(?:\.(\d+))?\s*\]\s*(.*)$/)
    if (!m) continue
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseFloat('0.' + m[3]) : 0)
    out.push({ startSec: start, rest: m[4].trim() })
  }
  return out
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

// Pull just the visual description out of one beat's text: drop the
// "Prompt:" / "Image Prompt:" / "Video Prompt:" label (or text after "→"),
// drop markdown bold, collapse to one line. No-op if no label found.
function cleanPrompt(s: string): string {
  let t = s.replace(/\*\*/g, '')
  const m = t.match(/\b(?:image\s+|video\s+|motion\s+)?prompt\s*:\s*/i)
  if (m && m.index !== undefined) t = t.slice(m.index + m[0].length)
  else if (t.includes('→')) t = t.slice(t.indexOf('→') + 1)
  return t.replace(/\s+/g, ' ').trim()
}

// A line that starts a new beat. Two shapes the workflow produces:
//  inline:  "B1 —", "1.", "2)", "#4 -"        (number + separator, content follows)
//  header:   "### BEAT 1", "BEAT 1", "Scene 3"  (heading on its own line)
//  bracket:  "[Beat 1]", "[Scene 1]", "[1]"     (the content/quote follows on same line)
const BEAT_BRACKET = /^\s*\[\s*(?:beat|scene)?\s*#?\d+\s*\]\s*[:.\-–—]?\s*/i
const BEAT_INLINE = /^\s*(?:scene|beat|b)?\s*#?\s*\d+\s*[^\w\s]{1,3}/i
const BEAT_HEADER = /^\s*#{0,6}\s*(?:beat|scene)\s+#?\d+\b/i
const isBeatHeader = (l: string): boolean => BEAT_BRACKET.test(l) || BEAT_HEADER.test(l) || BEAT_INLINE.test(l)
const stripBeatMarker = (l: string): string => l.replace(BEAT_BRACKET, '').replace(BEAT_HEADER, '').replace(BEAT_INLINE, '')

// Section/structure lines that must NOT leak into a beat's prompt (else they get
// drawn into the image, e.g. "ACT 3 / CHAPTER ONE" rendered as caption text).
function isNoiseLine(l: string): boolean {
  return /^\s*#{1,6}\s/.test(l)                  // markdown headers: ## CHAPTER ONE ...
    || /^\s*[-=*_]{3,}\s*$/.test(l)              // --- *** ___ separators
    || /^\s*>/.test(l)                           // blockquotes
    || /^\s*(?:act|chapter|part)\s+\w+/i.test(l) // "ACT 3 — ...", "CHAPTER ONE ..." (no #)
    || /^\s*\*?\s*end of\b/i.test(l)             // "*End of STATE 8 ...*"
}

// Split STATE 8 into per-beat { image, narration } — tolerant of two channel-clone formats:
//  A) B1 — "hook"                  Prompt: <visual>
//  B) ### BEAT 1 / Script: "<narration>" / Image Prompt: <visual>
// narration drives per-scene subtitle + duration weighting; image is the visual prompt.
function parseState8(text: string): { image: string; narration: string }[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\*\*/g, '') // drop markdown bold
  if (!raw.trim()) return []
  const lines = raw.split('\n')
  if (!lines.some(isBeatHeader)) return []

  const blocks: { inline: string; body: string }[] = []
  let cur: { inline: string; body: string[] } | null = null
  for (const line of lines) {
    if (isBeatHeader(line)) {
      if (cur) blocks.push({ inline: cur.inline, body: cur.body.join('\n') })
      const inline = stripBeatMarker(line).trim() // Format A: the hook quote
      cur = { inline, body: [] }
    } else if (cur && !isNoiseLine(line)) {
      cur.body.push(line)
    }
  }
  if (cur) blocks.push({ inline: cur.inline, body: cur.body.join('\n') })

  return blocks
    .map(({ inline, body }) => {
      // image = text after "Image Prompt:" / "Prompt:"
      const pm = body.match(/\b(?:image\s+)?prompt\s*:\s*/i)
      let image = pm && pm.index !== undefined ? body.slice(pm.index + pm[0].length) : body
      // narration = after "Script:" label, else the inline hook quote, else text before the prompt
      let narration = ''
      const sm = body.match(/\bscript\s*:\s*/i)
      if (sm && sm.index !== undefined) {
        narration = body.slice(sm.index + sm[0].length)
          .split(/\n\s*(?:image\s+prompt|prompt|camera|lighting|mood|action)\s*:/i)[0]
      } else if (inline) {
        narration = inline
      } else if (pm && pm.index !== undefined) {
        narration = body.slice(0, pm.index)
      }
      image = image.replace(/\s+/g, ' ').trim()
      narration = narration.replace(/[""„"]/g, '').replace(/\s+/g, ' ').trim()
      return { image, narration }
    })
    .filter((x) => x.image)
}

// Split a STATE list (e.g. STATE 9 video prompts) into items. Primary: a beat marker
// at line start (both formats). Fallbacks: blank-line paragraphs, then per-line.
// clean=true extracts the "Prompt:" / "→" portion of each item.
function parseList(text: string, clean = false): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\*\*/g, '')
  if (!raw.trim()) return []
  const out = (items: string[]) => items.map((x) => (clean ? cleanPrompt(x) : x.trim())).filter(Boolean)
  const lines = raw.split('\n')
  if (lines.some(isBeatHeader)) {
    const items: string[] = []
    let cur: string[] = []
    let started = false
    for (const line of lines) {
      if (isBeatHeader(line)) {
        if (started) items.push(cur.join('\n').trim())
        cur = [stripBeatMarker(line)]
        started = true
      } else if (started && !isNoiseLine(line)) {
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
  const [imageSource, setImageSource] = useState<'generate' | 'generate-free' | 'upload'>('generate')
  const [uploadImages, setUploadImages] = useState<File[]>([])
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
        // Upload-images mode: a scene needs narration OR a timestamp (image comes from uploads).
        if (imageSource === 'upload') return !!s.narration_text.trim() || s.startSec != null
        if (!s.image_prompt.trim()) return false
        if (voiceMode === 'tts') return !!s.narration_text.trim()
        if (voiceMode === 'upload') return !!s.audioFile
        return true // single
      }),
    [scenes, voiceMode, imageSource],
  )

  function applyBulk() {
    // Timestamp-locked doc ("[0:00] ...") → beats timed by their bracket, no voice script needed.
    // Only used for upload mode (own images + own audio); the [m:ss] gives each scene its duration.
    const ts = parseTimestampBeats(bulkImg)
    if (imageSource === 'upload' && ts.length >= 2) {
      const rows: SceneRow[] = ts.map((b) => ({
        image_prompt: b.rest, narration_text: '', video_prompt: '', audioFile: null, startSec: b.startSec,
      }))
      setScenes(rows)
      setShowBulk(false)
      toast.success(`${rows.length} scene (mode timestamp). Upload ${rows.length} gambar + audio, lalu Rakit — timing dari timestamp.`)
      return
    }
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

    // Upload-images mode: create scenes from the user's own images + narration/timestamp (no gen).
    if (imageSource === 'upload') {
      if (validScenes.length === 0) return toast.error('Tempel/parse narasi atau timestamp dulu (minimal 1 scene)')
      if (uploadImages.length !== validScenes.length) {
        return toast.error(`Jumlah gambar (${uploadImages.length}) harus sama dengan scene (${validScenes.length})`)
      }
      // Timestamp mode: every scene has a [m:ss] start → send per-scene durations (last holds to audio end).
      const tsMode = validScenes.every((s) => s.startSec != null)
      setSubmitting(true)
      try {
        const fd = new FormData()
        fd.append('title', title.trim())
        fd.append('mode', mode === 'kenburns' ? 'kenburns' : 'static')
        fd.append('aspectRatio', aspect)
        if (tsMode) {
          const starts = validScenes.map((s) => s.startSec as number)
          const durations = starts.map((st, i) => (i < starts.length - 1 ? Math.max(0.3, +(starts[i + 1] - st).toFixed(2)) : 4))
          fd.append('durations', JSON.stringify(durations))
        } else {
          fd.append('narrations', JSON.stringify(validScenes.map((s) => s.narration_text.trim())))
        }
        for (const img of uploadImages) fd.append('images', img)
        const res = await api.post<{ projectId: number; sceneCount: number }>('/api/veo/faceless-upload', fd)
        toast.success(tsMode
          ? `Project dibuat — ${res.sceneCount} scene (timing dari timestamp). Lanjut: upload audio → Rakit (tanpa Sync).`
          : `Project dibuat — ${res.sceneCount} scene (gambar upload). Lanjut: upload audio → Sync → Rakit.`)
        qc.invalidateQueries({ queryKey: ['veo-projects'] })
        navigate(`/faceless/${res.projectId}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal membuat project')
      } finally {
        setSubmitting(false)
      }
      return
    }

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
        imageProvider: imageSource === 'generate-free' ? 'pollinations' : 'geminigen',
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
            <div className="space-y-1.5 lg:col-span-4">
              <Label>Sumber Gambar</Label>
              <Select value={imageSource} onValueChange={(v) => setImageSource(v as 'generate' | 'generate-free' | 'upload')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="generate">Generate (Nano Banana — pakai kredit)</SelectItem>
                  <SelectItem value="generate-free">Generate gratis (Pollinations — $0)</SelectItem>
                  <SelectItem value="upload">Upload gambar sendiri (gratis)</SelectItem>
                </SelectContent>
              </Select>
              {imageSource === 'generate-free' && (
                <p className="text-xs text-muted-foreground">Gratis, tanpa kredit. Generate sekuensial (1 per 1) jadi agak lebih lama; resolusi 1024×576 lalu di-upscale ke 1080p saat rakit.</p>
              )}
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
            {imageSource === 'upload' && (
              <div className="space-y-1.5 lg:col-span-4 rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] p-3">
                <Label>Upload gambar kamu (urut sesuai narasi)</Label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setUploadImages(Array.from(e.target.files ?? []))}
                  className="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Pilih semua gambar sekaligus. Diurutkan otomatis by nama file (kasih nama <b>01, 02, 03…</b> atau <b>beat_01, beat_02…</b> biar urutannya pas). Jumlah gambar harus sama dengan jumlah scene.
                  {uploadImages.length > 0 && (
                    <span className={cn('ml-1 font-medium', uploadImages.length === validScenes.length ? 'text-emerald-400' : 'text-amber-400')}>
                      {' '}{uploadImages.length} gambar dipilih{validScenes.length > 0 ? ` / ${validScenes.length} scene` : ''}.
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  <b>Scene dari mana?</b> Tempel di kotak bawah salah satu: (a) naskah narasi per beat, atau (b) file <b>image-prompt "timestamp-locked"</b> (baris <b>[0:00] …</b>) — timing tiap gambar otomatis dari timestamp-nya, tanpa perlu naskah.
                </p>
                <p className="text-xs text-muted-foreground">Suara: nanti kamu <b>Upload narasi penuh</b> di halaman project. Mode timestamp <b>ga perlu Sync</b> (timing udah dari timestamp); mode naskah pakai <b>Sync</b>.</p>
              </div>
            )}
            {imageSource !== 'upload' && (
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
            )}
            {imageSource !== 'upload' && voiceMode === 'tts' && (
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
            {imageSource !== 'upload' && voiceMode === 'single' && (
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
            {imageSource !== 'upload' && voiceMode === 'upload' && (
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
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {imageSource === 'upload' ? 'Upload gambar...' : voiceMode === 'tts' ? 'Membuat...' : 'Upload audio...'}</>
                : <><Wand2 className="h-4 w-4" /> {imageSource === 'upload' ? `Buat project (${validScenes.length} scene)` : `Generate ${validScenes.length} Scene`}</>}
            </Button>
            {imageSource === 'generate' && mode === 'veo' && validScenes.length > 0 && (
              <span className="text-xs text-muted-foreground">≈ {validScenes.length * 3} kredit Veo</span>
            )}
            {imageSource === 'generate-free' && (
              <span className="text-xs text-emerald-400">Gratis (Pollinations){mode === 'veo' ? ' — tapi Veo tetap pakai kredit' : ''}</span>
            )}
            {imageSource === 'upload' && (
              <span className="text-xs text-emerald-400">Gratis (gambar sendiri)</span>
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
