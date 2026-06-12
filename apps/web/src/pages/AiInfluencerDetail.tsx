import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, AlertCircle, Trash2, Wand2, Download, Sparkles, RefreshCw,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { AiInfluencer } from '@/lib/types'

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
    </div>
  )
}
