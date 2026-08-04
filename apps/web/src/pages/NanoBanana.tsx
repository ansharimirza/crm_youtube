import { useState, useEffect, type ChangeEvent } from 'react'
import { Loader2, Sparkles, Download } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

// Free client-side image generation via Puter.js (Nano Banana / Gemini image). Runs entirely in
// the browser — no API key, no server credits. Supports a reference image for character consistency.
declare global {
  interface Window { puter?: { ai?: { txt2img: (prompt: string, opts?: Record<string, unknown>) => Promise<HTMLImageElement> } } }
}

const MODELS = [
  { v: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2 (gemini-3.1-flash-image)' },
  { v: 'gemini-3-pro-image', label: 'Nano Banana Pro (gemini-3-pro-image)' },
  { v: 'gemini-2.5-flash-image', label: 'Nano Banana 1 (gemini-2.5-flash-image)' },
]

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })
}

export function NanoBananaPage() {
  const [ready, setReady] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(MODELS[0].v)
  const [quality, setQuality] = useState('2K')
  const [aspect, setAspect] = useState('9:16')
  const [refUrl, setRefUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outUrl, setOutUrl] = useState<string | null>(null)

  // Load Puter.js once.
  useEffect(() => {
    if (window.puter?.ai) { setReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://js.puter.com/v2/'
    s.onload = () => setReady(true)
    s.onerror = () => toast.error('Gagal load Puter.js (cek koneksi / adblock)')
    document.head.appendChild(s)
  }, [])

  async function onRef(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setRefUrl(await fileToDataUrl(f))
  }

  async function generate() {
    if (!window.puter?.ai) { toast.error('Puter.js belum siap'); return }
    if (!prompt.trim()) { toast.error('Isi prompt dulu'); return }
    setBusy(true); setOutUrl(null)
    try {
      const [w, h] = aspect.split(':').map(Number)
      const opts: Record<string, unknown> = { model, quality, ratio: { w, h } } // quality 2K/4K = HD; ratio = aspect
      if (refUrl) opts.input_image = refUrl // reference for character consistency
      const img = await window.puter.ai.txt2img(prompt.trim(), opts)
      setOutUrl(img.src)
      toast.success('Gambar jadi!')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal generate (mungkin butuh login Puter buat volume lebih)')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="h-6 w-6 text-primary" /> Nano Banana (Gratis)</h1>
        <p className="text-sm text-muted-foreground">Generate gambar gratis via Puter.js (Nano Banana / Gemini image) — jalan di browser, tanpa API key, tanpa kredit server. Upload reference biar karakter konsisten.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test 1 gambar</CardTitle>
          <CardDescription>{ready ? '✅ Puter.js siap' : 'Loading Puter.js…'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{MODELS.map((m) => <SelectItem key={m.v} value={m.v} className="text-xs">{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kualitas (HD)</Label>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{['1K', '2K', '4K'].map((q) => <SelectItem key={q} value={q} className="text-xs">{q}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rasio</Label>
              <Select value={aspect} onValueChange={setAspect}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{['9:16', '16:9', '1:1'].map((a) => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reference image (opsional — biar karakter konsisten)</Label>
            <input type="file" accept="image/*" onChange={onRef}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            {refUrl && <img src={refUrl} alt="ref" className="h-20 rounded border" />}
          </div>
          <div className="space-y-1.5">
            <Label>Prompt</Label>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="Tempel 1 prompt gambar dari doc-mu…" className="text-sm" />
          </div>
          <Button onClick={generate} disabled={!ready || busy} className="w-full">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4" /> Generate</>}
          </Button>
          {outUrl && (
            <div className="space-y-2">
              <img src={outUrl} alt="hasil" className="w-full rounded-lg border" />
              <Button asChild size="sm" variant="outline"><a href={outUrl} download="nano.png"><Download className="h-4 w-4" /> Download</a></Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Kalau kualitas & konsistensinya oke, bilang — nanti aku bikin versi batch (auto-generate semua beat dari MD + reference, langsung jadi project TikTok).</p>
        </CardContent>
      </Card>
    </div>
  )
}
