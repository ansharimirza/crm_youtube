import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, Trash2, Loader2, AlertCircle, UserCircle2, Upload } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, getToken } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { AiInfluencer } from '@/lib/types'

export function AiInfluencerStudioPage() {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['ai-influencers'],
    queryFn: () => api.get<{ influencers: AiInfluencer[] }>('/api/ai-influencer'),
    refetchInterval: 4000,
  })
  const influencers = data?.influencers ?? []

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/ai-influencer/${id}`),
    onSuccess: () => {
      toast.success('Influencer dihapus')
      qc.invalidateQueries({ queryKey: ['ai-influencers'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Upload your own base photo → use it directly (no generation, no credits).
  const [upOpen, setUpOpen] = useState(false)
  const [upName, setUpName] = useState('')
  const [upGender, setUpGender] = useState('female')
  const [upPhoto, setUpPhoto] = useState<File | null>(null)
  const uploadMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('name', upName.trim() || 'Influencer')
      fd.append('gender', upGender)
      fd.append('base_image', upPhoto!)
      return api.post<{ influencer: AiInfluencer }>('/api/ai-influencer/from-photo', fd)
    },
    onSuccess: () => {
      toast.success('Base foto ke-upload — sekarang bisa bikin varian dari sini')
      setUpOpen(false); setUpName(''); setUpPhoto(null)
      qc.invalidateQueries({ queryKey: ['ai-influencers'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const imgSrc = (inf: AiInfluencer) =>
    inf.imageUrl || (inf.status === 'done' ? `/api/ai-influencer/${inf.id}/image?token=${getToken()}` : null)

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-violet-400" />
            AI Influencer
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-normal">
              Nano Banana Pro
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build a consistent AI persona for your content
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setUpOpen(true)}>
            <Upload className="h-4 w-4" /> Upload foto sendiri
          </Button>
          <Button asChild className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90">
            <Link to="/influencer/new">
              <Plus className="h-4 w-4" /> New Influencer
            </Link>
          </Button>
        </div>
      </div>

      <Dialog open={upOpen} onOpenChange={setUpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Upload foto base sendiri</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Foto-mu dipakai <b>langsung</b> jadi karakter base (nol kredit). Habis itu bisa bikin varian (outfit/pose/background) dari foto ini.</p>
            <div className="space-y-1.5"><Label>Nama</Label><Input value={upName} onChange={(e) => setUpName(e.target.value)} placeholder="Nama influencer" /></div>
            <div className="space-y-1.5"><Label>Gender</Label>
              <Select value={upGender} onValueChange={setUpGender}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label>Foto base</Label>
              <input type="file" accept="image/*" onChange={(e) => setUpPhoto(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
              {upPhoto && <img src={URL.createObjectURL(upPhoto)} alt="preview" className="h-24 rounded border mt-1" />}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setUpOpen(false)}>Batal</Button>
            <Button size="sm" disabled={!upPhoto || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>
              {uploadMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Upload…</> : 'Pakai foto ini'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {influencers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <UserCircle2 className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">Belum ada AI influencer</p>
            <Button asChild className="mt-4 bg-gradient-to-r from-pink-500 to-violet-500" size="sm">
              <Link to="/influencer/new">
                <Plus className="h-4 w-4" />
                Buat Influencer Pertama
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {influencers.map(inf => (
            <Card key={inf.id} className="hover:border-primary/40 transition-colors group overflow-hidden">
              <Link to={`/influencer/${inf.id}`} className="block">
                <div className="relative aspect-[9/16] bg-gradient-to-br from-pink-500/10 to-violet-500/10">
                  {imgSrc(inf) ? (
                    <img src={imgSrc(inf)!} className="w-full h-full object-cover" alt={inf.name} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {inf.status === 'processing' || inf.status === 'queued' ? (
                        <div className="text-center">
                          <Loader2 className="h-10 w-10 text-primary/50 mx-auto animate-spin" />
                          <p className="text-xs text-muted-foreground mt-2">Generating...</p>
                        </div>
                      ) : inf.status === 'error' ? (
                        <div className="text-center px-3">
                          <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
                          <p className="text-xs text-red-400 mt-2 line-clamp-2">{inf.errorMsg ?? 'Error'}</p>
                        </div>
                      ) : (
                        <UserCircle2 className="h-12 w-12 text-muted-foreground/40" />
                      )}
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                    <Badge className="bg-black/60 text-white text-[10px] border-0">{inf.gender}, {inf.age}</Badge>
                    {inf.aestheticVibe && (
                      <Badge className="bg-violet-500/30 text-violet-200 text-[10px] border-0">{inf.aestheticVibe}</Badge>
                    )}
                  </div>
                </div>
                <CardContent className="p-3">
                  <h3 className="font-medium truncate">{inf.name}</h3>
                  {inf.niches && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                      {inf.niches.split('|').filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="text-[10px] text-muted-foreground/60 mt-2">
                    {formatRelativeTime(inf.createdAt)}
                  </div>
                </CardContent>
              </Link>
              <div className="border-t flex items-center justify-end px-2 py-1">
                <Button
                  size="icon" variant="ghost"
                  className={cn('h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10')}
                  onClick={() => { if (confirm(`Hapus "${inf.name}"?`)) deleteMutation.mutate(inf.id) }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
