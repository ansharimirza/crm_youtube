import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Loader2, Package } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { toast } from 'sonner'

// Upload several video clips + one narration → assemble into one video (clips in order,
// narration overlaid, clip audio muted, total trimmed to the narration length). Free, no Veo.
export function RakitKlipPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [clips, setClips] = useState<File[]>([])
  const [narration, setNarration] = useState<File | null>(null)

  const mut = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('title', title.trim() || 'Rakit Klip')
      for (const c of clips) fd.append('clips', c)
      fd.append('narration', narration!)
      return api.post<{ projectId: number; sceneCount: number }>('/api/veo/assemble-clips', fd)
    },
    onSuccess: (r) => {
      toast.success(`${r.sceneCount} klip + narasi ke-upload — lagi dirakit...`)
      navigate(`/veo/${r.projectId}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canSubmit = clips.length > 0 && !!narration && !mut.isPending

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6 text-primary" /> Rakit Klip</h1>
        <p className="text-sm text-muted-foreground">Upload beberapa klip video + 1 narasi → digabung urut, narasi dipasang, dipotong pas durasi narasi. Gratis (tanpa Veo).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload</CardTitle>
          <CardDescription>Klip diputar urut sesuai nama file (01, 02, …). Audio klip di-mute, diganti narasi. Kelebihan video di ujung dipotong.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Judul</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul project" />
          </div>
          <div className="space-y-1.5">
            <Label>Klip video (bisa banyak)</Label>
            <input type="file" accept="video/*" multiple onChange={(e) => setClips(Array.from(e.target.files ?? []))}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            {clips.length > 0 && <p className="text-xs text-emerald-400">{clips.length} klip dipilih (urut: {clips.map((c) => c.name).slice(0, 3).join(', ')}{clips.length > 3 ? '…' : ''})</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Narasi (1 file audio)</Label>
            <input type="file" accept="audio/*" onChange={(e) => setNarration(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            {narration && <p className="text-xs text-emerald-400">🔊 {narration.name}</p>}
          </div>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit} className="w-full">
            {mut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Meng-upload & merakit…</> : <><Package className="h-4 w-4" /> Rakit jadi 1 video</>}
          </Button>
          <p className="text-[11px] text-muted-foreground">Setelah upload, kamu diarahin ke halaman project — video final muncul begitu render selesai. Upload video besar bisa makan waktu (tergantung koneksi).</p>
        </CardContent>
      </Card>
    </div>
  )
}
