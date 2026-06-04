import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle2, RefreshCw, Download,
  Play, Clock, Film, FileText, Copy as CopyIcon, Trash2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { TiktokCampaign, TiktokScene, TiktokMode, TiktokContentType } from '@/lib/types'

const MODE_LABELS: Record<TiktokMode, string> = {
  ugc: 'UGC',
  pov_hand: 'POV Hand Review',
  mirror_check: 'Mirror Check',
}

const CT_LABELS: Record<TiktokContentType, string> = {
  review: 'Review',
  unboxing: 'Unboxing',
  affiliate: 'Affiliate',
}

const STATUS_STYLE: Record<TiktokScene['status'], { label: string; bg: string; text: string; icon: typeof Loader2 }> = {
  queued:     { label: 'Queued',     bg: 'bg-slate-500/20',  text: 'text-slate-300',  icon: Clock },
  processing: { label: 'Processing', bg: 'bg-blue-500/20',   text: 'text-blue-300',   icon: Loader2 },
  done:       { label: 'Done',       bg: 'bg-emerald-500/20', text: 'text-emerald-300', icon: CheckCircle2 },
  error:      { label: 'Error',      bg: 'bg-red-500/20',    text: 'text-red-300',    icon: AlertCircle },
}

export function TiktokCampaignPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['tiktok-campaign', id],
    queryFn: () => api.get<{ campaign: TiktokCampaign }>(`/api/tiktok/campaigns/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  })

  const retryMutation = useMutation({
    mutationFn: (sceneId: number) => api.post(`/api/tiktok/scenes/${sceneId}/retry`, {}),
    onSuccess: () => {
      toast.success('Scene di-queue ulang')
      qc.invalidateQueries({ queryKey: ['tiktok-campaign', id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/tiktok/campaigns/${id}`),
    onSuccess: () => {
      toast.success('Campaign dihapus')
      navigate('/tiktok')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const campaign = data?.campaign
  if (!campaign) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Campaign tidak ditemukan
      </div>
    )
  }

  const scenes = campaign.scenes ?? []
  const doneScenes = scenes.filter(s => s.status === 'done')
  const errorScenes = scenes.filter(s => s.status === 'error')
  const processingScenes = scenes.filter(s => s.status === 'processing' || s.status === 'queued')

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/tiktok">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{campaign.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{campaign.productName}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge variant="secondary">{MODE_LABELS[campaign.mode]}</Badge>
              <Badge variant="secondary">{CT_LABELS[campaign.contentType]}</Badge>
              <Badge variant="outline">{campaign.aspectRatio}</Badge>
              <Badge variant="outline">{campaign.resolution}</Badge>
              <Badge variant="outline">{campaign.veoModel}</Badge>
              <Badge variant="outline">{campaign.language === 'id' ? 'ID' : 'EN'}</Badge>
            </div>
            <div className="text-xs text-muted-foreground/60 mt-2">
              {formatRelativeTime(campaign.createdAt)}
            </div>
          </div>
          <div className="flex gap-2">
            {doneScenes.length > 0 && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/tiktok/campaigns/${campaign.id}/download-zip`}>
                  <Download className="h-4 w-4" />
                  Download ZIP
                </a>
              </Button>
            )}
            <Button
              variant="outline" size="sm" className="text-red-400 hover:text-red-300"
              onClick={() => { if (confirm('Hapus campaign ini?')) deleteMutation.mutate() }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Progress overview */}
      <Card>
        <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Total Scenes" value={scenes.length} />
          <Stat label="Selesai" value={doneScenes.length} color="text-emerald-400" />
          <Stat label="Proses" value={processingScenes.length} color="text-blue-400" />
          <Stat label="Error" value={errorScenes.length} color="text-red-400" />
        </CardContent>
      </Card>

      {/* Environment + product */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Setting</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Environment</div>
            <p className="mt-1">{campaign.environment}</p>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Produk</div>
            <p className="mt-1">{campaign.productName}</p>
            {campaign.productDescription && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{campaign.productDescription}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Scenes */}
      <div>
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Film className="h-4 w-4" />
          Scenes ({scenes.length})
        </h2>
        <div className="grid md:grid-cols-2 gap-3">
          {scenes.map(scene => (
            <SceneCard
              key={scene.id}
              scene={scene}
              aspectRatio={campaign.aspectRatio}
              onRetry={() => retryMutation.mutate(scene.id)}
              isRetrying={retryMutation.isPending}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function SceneCard({
  scene, aspectRatio, onRetry, isRetrying,
}: {
  scene: TiktokScene
  aspectRatio: '9:16' | '16:9' | '1:1'
  onRetry: () => void
  isRetrying: boolean
}) {
  const style = STATUS_STYLE[scene.status]
  const Icon = style.icon
  const aspectClass = aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video'

  return (
    <Card className="overflow-hidden">
      <div className={cn('relative bg-gradient-to-br from-pink-500/10 to-violet-500/10 max-h-72 mx-auto', aspectClass)}>
        {scene.videoUrl ? (
          <video
            src={scene.videoUrl}
            controls
            poster={scene.thumbnailUrl ?? undefined}
            className="w-full h-full object-cover"
          />
        ) : scene.thumbnailUrl ? (
          <img src={scene.thumbnailUrl} className="w-full h-full object-cover" alt="" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon className={cn('h-10 w-10', style.text, scene.status === 'processing' && 'animate-spin')} />
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-2">
          <Badge className={cn('text-xs border-0', style.bg, style.text)}>
            <Icon className={cn('h-3 w-3', scene.status === 'processing' && 'animate-spin')} />
            {style.label}
          </Badge>
          {scene.status === 'processing' && scene.progress > 0 && (
            <Badge className="text-xs bg-blue-500/20 text-blue-300 border-0">
              {scene.progress}%
            </Badge>
          )}
        </div>
        <div className="absolute top-2 right-2">
          <Badge className="text-xs bg-black/60 text-white border-0">
            #{scene.sceneNumber} · {scene.duration}s
          </Badge>
        </div>
      </div>
      <CardContent className="p-3 space-y-2">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Script
        </div>
        <p className="text-sm leading-relaxed line-clamp-3">{scene.script}</p>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Veo prompt</summary>
          <div className="mt-1 p-2 bg-muted/30 rounded text-[11px] font-mono leading-relaxed">
            {scene.veoPrompt}
          </div>
        </details>
        {scene.errorMsg && (
          <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">
            {scene.errorMsg}
          </div>
        )}
        <div className="flex items-center gap-1 pt-1">
          {scene.videoUrl && (
            <>
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                <a href={scene.videoUrl} target="_blank" rel="noopener noreferrer">
                  <Play className="h-3 w-3" /> Buka
                </a>
              </Button>
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                <a href={scene.videoUrl} download>
                  <Download className="h-3 w-3" /> Download
                </a>
              </Button>
            </>
          )}
          <Button
            size="sm" variant="ghost" className="h-7 text-xs"
            onClick={() => { navigator.clipboard.writeText(scene.script); toast.success('Script disalin') }}
          >
            <CopyIcon className="h-3 w-3" /> Copy
          </Button>
          {scene.status === 'error' && (
            <Button
              size="sm" variant="ghost" className="h-7 text-xs ml-auto"
              onClick={onRetry}
              disabled={isRetrying}
            >
              <RefreshCw className={cn('h-3 w-3', isRetrying && 'animate-spin')} />
              Retry
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
