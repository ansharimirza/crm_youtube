import { useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Loader2, Video } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { toast } from 'sonner'

// TikTok faceless: paste the beat-sheet MD + upload own images (named 1a/1b) + narration.
// Backend parses the MD, matches images to beats, creates a 9:16 Veo project. Then on the
// project page: Sync → Generate semua Veo → Rakit.
export function TiktokFacelessPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [md, setMd] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [narration, setNarration] = useState<File | null>(null)

  async function loadMd(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setMd(await f.text())
  }

  const mut = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('title', title.trim() || 'TikTok')
      fd.append('md', md)
      fd.append('narration', narration!)
      for (const img of images) fd.append('images', img)
      return api.post<{ projectId: number; sceneCount: number; veoCount: number }>('/api/veo/tiktok-upload', fd)
    },
    onSuccess: (r) => {
      toast.success(`${r.sceneCount} beat dibuat (semua Veo). Lanjut: Sync → Generate semua Veo → Rakit.`)
      navigate(`/faceless/${r.projectId}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canSubmit = md.trim().length > 0 && images.length > 0 && !!narration && !mut.isPending

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Video className="h-6 w-6 text-primary" /> TikTok Faceless</h1>
        <p className="text-sm text-muted-foreground">Upload MD beat sheet + gambarmu (9:16) + narasi → tiap beat jadi klip Veo (START+END morphing / SINGLE). Aku rakit.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload</CardTitle>
          <CardDescription>
            Nama gambar urut aja (<b>beat_01, beat_02, …</b>) — <b>ga usah rename ke 1a/1b</b>. Sistem consume berurutan sesuai MD: beat START+END pakai 2 gambar (START dulu, END sesudahnya), beat SINGLE 1 gambar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Judul</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul project" />
          </div>
          <div className="space-y-1.5">
            <Label>MD beat sheet (STATE)</Label>
            <Textarea value={md} onChange={(e) => setMd(e.target.value)} rows={5} placeholder="Tempel MD (BEAT 1 / [Segmen] … / Motion: …) atau upload file di bawah" className="text-xs" />
            <input type="file" accept=".md,.txt" onChange={loadMd}
              className="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
          </div>
          <div className="space-y-1.5">
            <Label>Gambar (banyak, nama 1a/1b/2a/2b…)</Label>
            <input type="file" accept="image/*" multiple onChange={(e) => setImages(Array.from(e.target.files ?? []))}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            {images.length > 0 && <p className="text-xs text-emerald-400">{images.length} gambar dipilih</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Narasi (1 file audio)</Label>
            <input type="file" accept="audio/*" onChange={(e) => setNarration(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            {narration && <p className="text-xs text-emerald-400">🔊 {narration.name}</p>}
          </div>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit} className="w-full">
            {mut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Meng-upload…</> : <><Video className="h-4 w-4" /> Buat project TikTok</>}
          </Button>
          <p className="text-[11px] text-muted-foreground">Semua beat = klip Veo (pakai kredit). Setelah dibuat → halaman project: <b>Sync</b> → <b>Generate semua Veo</b> → <b>Rakit</b>.</p>
        </CardContent>
      </Card>
    </div>
  )
}
