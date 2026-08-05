import { useState, useEffect, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, Video, RotateCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { toast } from 'sonner'

declare global {
  interface Window { puter?: { ai?: { txt2img: (prompt: string, opts?: Record<string, unknown>) => Promise<HTMLImageElement> } } }
}

// Parse the VEO-3 image-prompt doc: "BEAT n | 6s | START+END | REF: …" then "START: …", "END: …".
// Produces a flat list of generation slots (START, then END for START+END beats).
type Slot = { beat: number; kind: 'start' | 'end'; prompt: string }
function parseImgDoc(text: string): Slot[] {
  const raw = text.replace(/\r\n/g, '\n')
  // KLIP storyboard format: "KLIP n … IMAGE 1 (START): ```…``` IMAGE 2 (END): ```…```" (all start+end).
  if (/\bKLIP\s+\d+/i.test(raw) && /IMAGE\s*1/i.test(raw)) {
    const out: Slot[] = []
    for (const m of raw.matchAll(/\bKLIP\s+(\d+)\b([\s\S]*?)(?=\bKLIP\s+\d+\b|$)/gi)) {
      const beat = Number(m[1]); const body = m[2]
      const img1 = body.match(/IMAGE\s*1[^\n]*:[^\n]*\n```[a-z]*\n?([\s\S]*?)```/i)?.[1]?.trim()
      const img2 = body.match(/IMAGE\s*2[^\n]*:[^\n]*\n```[a-z]*\n?([\s\S]*?)```/i)?.[1]?.trim()
      if (img1) out.push({ beat, kind: 'start', prompt: img1 })
      if (img2) out.push({ beat, kind: 'end', prompt: img2 })
    }
    if (out.length) return out
  }
  const blocks: { beat: number; header: string; body: string[] }[] = []
  let cur: { beat: number; header: string; body: string[] } | null = null
  for (const l of raw.split('\n')) {
    const m = l.match(/^-*\s*BEAT\s+(\d+)\b(.*)/i)
    if (m) { if (cur) blocks.push(cur); cur = { beat: Number(m[1]), header: m[2], body: [] } }
    else if (cur && !/^[-=]+$/.test(l.trim()) && !/END OF/i.test(l)) cur.body.push(l)
  }
  if (cur) blocks.push(cur)
  const slots: Slot[] = []
  for (const b of blocks) {
    const body = b.body.join('\n')
    const isSE = /START\s*\+\s*END/i.test(b.header) || /START\s*\+\s*END/i.test(body)
    const start = (body.match(/START:\s*([\s\S]*?)(?=\n\s*(?:END:|MOTION:)|$)/i)?.[1] || '').trim()
    const end = (body.match(/END:\s*([\s\S]*?)(?=\n\s*MOTION:|$)/i)?.[1] || '').trim()
    if (start) slots.push({ beat: b.beat, kind: 'start', prompt: start })
    if (isSE && end) slots.push({ beat: b.beat, kind: 'end', prompt: end })
  }
  return slots
}

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })
}

type Img = { status: 'pending' | 'busy' | 'done' | 'error'; src?: string; err?: string }

export function TiktokAutoPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [title, setTitle] = useState('')
  const [doc, setDoc] = useState('') // whole Doc-4 (BEAT SHEET + IMAGE PROMPTS) — used for both parsers
  const [refUrl, setRefUrl] = useState<string | null>(null)
  const [audio, setAudio] = useState<File | null>(null)
  const [quality, setQuality] = useState('2K')
  const [aspect, setAspect] = useState('9:16')
  const [slots, setSlots] = useState<Slot[]>([])
  const [imgs, setImgs] = useState<Img[]>([])
  const [running, setRunning] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (window.puter?.ai) { setReady(true); return }
    const s = document.createElement('script'); s.src = 'https://js.puter.com/v2/'
    s.onload = () => setReady(true); s.onerror = () => toast.error('Gagal load Puter.js')
    document.head.appendChild(s)
  }, [])

  function doParse() {
    const s = parseImgDoc(doc)
    if (s.length === 0) return toast.error('Doc ga kebaca (butuh BAGIAN 2 IMAGE PROMPTS: "BEAT n … START: … END: …")')
    setSlots(s); setImgs(s.map(() => ({ status: 'pending' as const })))
    toast.success(`${s.length} gambar terdeteksi. Klik "Generate semua".`)
  }

  async function genOne(i: number, s: Slot): Promise<boolean> {
    if (!window.puter?.ai) return false
    setImgs((p) => p.map((x, idx) => idx === i ? { status: 'busy' } : x))
    try {
      const [w, h] = aspect.split(':').map(Number)
      const opts: Record<string, unknown> = { model: 'gemini-3.1-flash-image-preview', quality, ratio: { w, h } }
      if (refUrl) opts.input_image = refUrl
      const img = await window.puter.ai.txt2img(s.prompt, opts)
      setImgs((p) => p.map((x, idx) => idx === i ? { status: 'done', src: img.src } : x))
      return true
    } catch (e) {
      setImgs((p) => p.map((x, idx) => idx === i ? { status: 'error', err: e instanceof Error ? e.message : 'gagal' } : x))
      return false
    }
  }

  async function genAll() {
    setRunning(true)
    for (let i = 0; i < slots.length; i++) {
      if (imgs[i]?.status === 'done') continue
      await genOne(i, slots[i])
    }
    setRunning(false)
    toast.success('Selesai generate. Cek hasilnya, retry yang gagal kalau ada.')
  }

  const doneCount = imgs.filter((x) => x.status === 'done').length
  const allDone = slots.length > 0 && doneCount === slots.length

  async function createProject() {
    if (!doc.trim()) return toast.error('Tempel doc dulu')
    if (!audio) return toast.error('Upload narasi (audio) dulu')
    setCreating(true)
    try {
      const fd = new FormData()
      fd.append('title', title.trim() || 'TikTok')
      fd.append('md', doc)
      fd.append('narration', audio)
      // Generated images in flat order → beat_01, beat_02, … (matches /tiktok-upload's ordered consume).
      for (let i = 0; i < imgs.length; i++) {
        const src = imgs[i].src!
        const blob = await (await fetch(src)).blob()
        fd.append('images', new File([blob], `beat_${String(i + 1).padStart(2, '0')}.png`, { type: blob.type || 'image/png' }))
      }
      const r = await api.post<{ projectId: number; sceneCount: number }>('/api/veo/tiktok-upload', fd)
      toast.success(`Project dibuat — ${r.sceneCount} beat. Lanjut: Sync → Generate Veo → Rakit.`)
      navigate(`/faceless/${r.projectId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal buat project')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Video className="h-6 w-6 text-primary" /> TikTok Auto (gambar gratis)</h1>
        <p className="text-sm text-muted-foreground">Tempel doc gambar + narasi + reference → app auto-generate semua gambar (Nano Banana gratis, di browser) → langsung jadi project TikTok.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Input</CardTitle><CardDescription>{ready ? '✅ Puter.js siap' : 'Loading Puter.js…'}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5"><Label>Judul</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul project" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Kualitas</Label>
              <Select value={quality} onValueChange={setQuality}><SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{['1K', '2K', '4K'].map((q) => <SelectItem key={q} value={q} className="text-xs">{q}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Rasio</Label>
              <Select value={aspect} onValueChange={setAspect}><SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{['9:16', '16:9', '1:1'].map((a) => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label>Reference karakter (biar konsisten)</Label>
            <input type="file" accept="image/*" onChange={async (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) setRefUrl(await fileToDataUrl(f)) }}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            {refUrl && <img src={refUrl} alt="ref" className="h-16 rounded border" />}</div>
          <div className="space-y-1.5"><Label>Doc lengkap (.md — BAGIAN 1 BEAT SHEET + BAGIAN 2 IMAGE PROMPTS)</Label>
            <input type="file" accept=".md,.txt" onChange={async (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { setDoc(await f.text()); toast.success(`File "${f.name}" ke-load`) } }}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            <Textarea value={doc} onChange={(e) => setDoc(e.target.value)} rows={5} placeholder="Upload file .md di atas, ATAU tempel manual di sini (SELURUH file — BAGIAN 1 + BAGIAN 2)." className="text-xs" />
            <p className="text-[11px] text-muted-foreground">Pakai file <b>.md</b> (Doc 4 — 2 bagian). File .txt all-in-one ga cocok.</p></div>
          <div className="space-y-1.5"><Label>Narasi (audio)</Label>
            <input type="file" accept="audio/*" onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            {audio && <span className="text-[11px] text-emerald-400">🔊 {audio.name}</span>}</div>
          <Button variant="outline" onClick={doParse} disabled={!doc.trim()}>Deteksi gambar dari doc</Button>
        </CardContent>
      </Card>

      {slots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Generate gambar ({doneCount}/{slots.length})</CardTitle>
            <CardDescription>Nano Banana gratis, di browser-mu. Butuh beberapa menit — jangan tutup tab.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={genAll} disabled={!ready || running}>
              {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating {doneCount}/{slots.length}…</> : <><Sparkles className="h-4 w-4" /> Generate semua ({slots.length})</>}
            </Button>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {slots.map((s, i) => (
                <div key={i} className="relative aspect-[9/16] rounded border bg-muted/30 overflow-hidden flex items-center justify-center">
                  {imgs[i]?.src ? <img src={imgs[i].src} alt="" className="w-full h-full object-cover" /> : null}
                  {imgs[i]?.status === 'busy' && <Loader2 className="h-4 w-4 animate-spin absolute" />}
                  {imgs[i]?.status === 'error' && <button className="absolute inset-0 flex items-center justify-center text-red-400" onClick={() => genOne(i, s)}><RotateCw className="h-4 w-4" /></button>}
                  <span className="absolute bottom-0 left-0 text-[9px] bg-black/60 px-1 rounded-tr">b{s.beat}{s.kind === 'end' ? 'E' : ''}</span>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={createProject} disabled={!allDone || creating}>
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Bikin project…</> : <><Video className="h-4 w-4" /> Buat project TikTok {allDone ? '' : `(tunggu ${slots.length - doneCount} gambar lagi)`}</>}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
