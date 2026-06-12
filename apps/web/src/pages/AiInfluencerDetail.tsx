import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, AlertCircle, Trash2, Wand2, Download, Sparkles, RefreshCw,
  Lock, ImagePlus, Plus, X,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api, getToken } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'
import type { AiInfluencer, AiInfluencerVariant } from '@/lib/types'

export function AiInfluencerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [instruction, setInstruction] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['ai-influencer', id],
    queryFn: () => api.get<{ influencer: AiInfluencer }>(`/api/ai-influencer/${id}`),
    enabled: !!id,
    refetchInterval: 3000,
  })

  const regenerateMutation = useMutation({
    mutationFn: (inst: string) => api.post(`/api/ai-influencer/${id}/regenerate`, { instruction: inst }),
    onSuccess: () => {
      toast.success('Regenerating...')
      setInstruction('')
      qc.invalidateQueries({ queryKey: ['ai-influencer', id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/ai-influencer/${id}`),
    onSuccess: () => { toast.success('Influencer dihapus'); navigate('/influencer') },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const inf = data?.influencer
  if (!inf) {
    return <div className="text-center py-20 text-muted-foreground">Influencer tidak ditemukan</div>
  }

  const niches = inf.niches.split('|').filter(Boolean)
  const isProcessing = inf.status === 'processing' || inf.status === 'queued'

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/influencer">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{inf.name}</h1>
            <p className="text-sm text-muted-foreground mt-1 capitalize">
              {inf.gender}, {inf.age} · {inf.ethnicity}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {inf.aestheticVibe && <Badge variant="secondary">{inf.aestheticVibe}</Badge>}
              {niches.map(n => <Badge key={n} variant="outline">{n}</Badge>)}
            </div>
            <div className="text-xs text-muted-foreground/60 mt-2">{formatRelativeTime(inf.createdAt)}</div>
          </div>
          <div className="flex gap-2">
            {inf.imageUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={inf.imageUrl} download={`${inf.name}.jpg`}>
                  <Download className="h-4 w-4" />
                  Download
                </a>
              </Button>
            )}
            <Button
              variant="outline" size="sm"
              className="text-red-400 hover:text-red-300"
              onClick={() => { if (confirm(`Hapus "${inf.name}"?`)) deleteMutation.mutate() }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Image */}
        <Card className="overflow-hidden">
          <div className="relative aspect-[9/16] bg-gradient-to-br from-pink-500/10 to-violet-500/10">
            {inf.imageUrl ? (
              <img src={inf.imageUrl} className="w-full h-full object-cover" alt={inf.name} />
            ) : isProcessing ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 text-primary/50 mx-auto animate-spin" />
                  <p className="text-sm text-muted-foreground mt-3">Generating with Nano Banana...</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">~30-60 detik</p>
                </div>
              </div>
            ) : inf.status === 'error' ? (
              <div className="w-full h-full flex items-center justify-center px-4">
                <div className="text-center max-w-xs">
                  <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
                  <p className="text-sm text-red-400 mt-3">{inf.errorMsg ?? 'Error'}</p>
                  <Button
                    onClick={() => regenerateMutation.mutate('')}
                    disabled={regenerateMutation.isPending}
                    className="mt-4 bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90"
                  >
                    {regenerateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Coba lagi
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        {/* Revisi + meta */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-300 uppercase tracking-wide">
                <Wand2 className="h-4 w-4" />
                Revisi
              </div>
              <Input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Cth: rambut lebih pendek, senyum, baju casual..."
                disabled={isProcessing}
              />
              <Button
                onClick={() => regenerateMutation.mutate(instruction)}
                disabled={isProcessing || regenerateMutation.isPending}
                className="w-full bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90"
              >
                {regenerateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {instruction.trim() ? 'Apply Revisi' : 'Regenerate'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Kosongkan kolom untuk regenerate ulang dengan prompt yang sama.
              </p>
            </CardContent>
          </Card>

          {inf.status === 'done' && inf.imageUrl && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="p-4 flex items-start gap-2">
                <Lock className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-medium text-emerald-300">Identity locked</p>
                  <p className="text-muted-foreground mt-0.5">
                    Image utama dipakai sebagai face/body reference. Bikin variant di bawah untuk ganti outfit/background tanpa ngubah identitas.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-3 text-sm">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Physical</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div><span className="text-muted-foreground">Skin:</span> {inf.skinTone}</div>
                <div><span className="text-muted-foreground">Hair:</span> {inf.hairColor}</div>
                <div><span className="text-muted-foreground">Length:</span> {inf.hairLength}</div>
                <div><span className="text-muted-foreground">Texture:</span> {inf.hairTexture}</div>
                <div><span className="text-muted-foreground">Eyes:</span> {inf.eyeColor}</div>
                <div><span className="text-muted-foreground">Build:</span> {inf.build}</div>
              </div>
              {inf.customDescription && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Notes: </span>{inf.customDescription}
                </div>
              )}
              {inf.backstory && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Backstory</summary>
                  <p className="mt-2 leading-relaxed">{inf.backstory}</p>
                </details>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Prompt (debug)</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed bg-muted/30 p-2 rounded max-h-60 overflow-auto">{inf.imagePrompt}</pre>
              </details>
            </CardContent>
          </Card>
        </div>
      </div>

      {inf.status === 'done' && inf.imageUrl && (
        <VariantsSection influencerId={inf.id} influencerImageUrl={inf.imageUrl} />
      )}
    </div>
  )
}

function VariantsSection({ influencerId, influencerImageUrl }: { influencerId: number; influencerImageUrl: string }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [changeDesc, setChangeDesc] = useState('')
  const [refImage, setRefImage] = useState<File | null>(null)
  const [refPreview, setRefPreview] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['ai-influencer-variants', influencerId],
    queryFn: () => api.get<{ variants: AiInfluencerVariant[] }>(`/api/ai-influencer/${influencerId}/variants`),
    refetchInterval: 3000,
  })
  const variants = data?.variants ?? []

  function handleRefFile(file: File | null) {
    if (!file) return
    setRefImage(file)
    const reader = new FileReader()
    reader.onload = (e) => setRefPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      if (changeDesc.trim()) fd.append('change_description', changeDesc.trim())
      if (refImage) fd.append('reference_image', refImage)
      const res = await fetch(`/api/ai-influencer/${influencerId}/variants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    },
    onSuccess: () => {
      toast.success('Variant sedang di-generate')
      setShowForm(false)
      setChangeDesc('')
      setRefImage(null)
      setRefPreview(null)
      qc.invalidateQueries({ queryKey: ['ai-influencer-variants', influencerId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (variantId: number) =>
      api.delete(`/api/ai-influencer/${influencerId}/variants/${variantId}`),
    onSuccess: () => {
      toast.success('Variant dihapus')
      qc.invalidateQueries({ queryKey: ['ai-influencer-variants', influencerId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canSubmit = changeDesc.trim().length > 0 || refImage

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-violet-400" />
          Variants <span className="text-xs font-normal text-muted-foreground">({variants.length})</span>
        </h2>
        {!showForm && (
          <Button
            size="sm"
            onClick={() => setShowForm(true)}
            className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Tambah Variant
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="border-violet-500/30 bg-violet-500/5">
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Apa yang berubah?
              </label>
              <Textarea
                value={changeDesc}
                onChange={(e) => setChangeDesc(e.target.value)}
                placeholder="Cth: baju kemeja putih oversized, lagi nongkrong di cafe outdoor sore hari"
                rows={3}
                maxLength={1000}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Reference image (opsional) — outfit / background inspo
              </label>
              {refPreview ? (
                <div className="relative inline-block">
                  <img src={refPreview} className="rounded-lg max-h-48 border" alt="" />
                  <Button
                    type="button" size="icon" variant="secondary"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => { setRefImage(null); setRefPreview(null) }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <label className="flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer hover:border-violet-500/50 w-fit">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Upload outfit / background reference...</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRefFile(e.target.files?.[0] ?? null)} />
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Batal</Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!canSubmit || createMutation.isPending}
                className="bg-gradient-to-r from-pink-500 to-violet-500"
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate Variant
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {variants.length === 0 && !showForm ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Wand2 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Belum ada variant</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">
              Generate variasi dengan baju / background berbeda — wajah tetap sama persis
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* Locked anchor card */}
          <Card className="overflow-hidden border-emerald-500/30">
            <div className="relative aspect-[9/16]">
              <img src={influencerImageUrl} className="w-full h-full object-cover" alt="locked" />
              <div className="absolute top-2 left-2">
                <Badge className="bg-emerald-500/30 text-emerald-200 border-0 text-[10px]">
                  <Lock className="h-2.5 w-2.5" />
                  ANCHOR
                </Badge>
              </div>
            </div>
          </Card>

          {variants.map(v => (
            <Card key={v.id} className="overflow-hidden group">
              <div className="relative aspect-[9/16] bg-gradient-to-br from-pink-500/10 to-violet-500/10">
                {v.imageUrl ? (
                  <img src={v.imageUrl} className="w-full h-full object-cover" alt="" />
                ) : v.status === 'processing' || v.status === 'queued' ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 className="h-8 w-8 text-primary/50 animate-spin" />
                  </div>
                ) : v.status === 'error' ? (
                  <div className="w-full h-full flex items-center justify-center px-2">
                    <div className="text-center">
                      <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
                      <p className="text-[10px] text-red-400 mt-1 line-clamp-2">{v.errorMsg}</p>
                    </div>
                  </div>
                ) : null}
                <Button
                  size="icon" variant="secondary"
                  className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => { if (confirm('Hapus variant?')) deleteMutation.mutate(v.id) }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <CardContent className="p-2">
                <p className="text-[11px] line-clamp-2 leading-tight">
                  {v.changeDescription || (v.referenceImagePath ? '(from reference)' : '(no description)')}
                </p>
                {v.imageUrl && (
                  <Button asChild size="sm" variant="ghost" className="h-6 mt-1 text-[10px] w-full">
                    <a href={v.imageUrl} download={`variant-${v.id}.jpg`}>
                      <Download className="h-3 w-3" />
                      Download
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
