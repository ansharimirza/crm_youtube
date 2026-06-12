import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle2, RefreshCw, Download, Trash2, PersonStanding,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { MotionVideo } from '@/lib/types'

const STATUS: Record<MotionVideo['status'], { label: string; bg: string; text: string; icon: typeof Loader2 }> = {
  queued:     { label: 'Queued',     bg: 'bg-slate-500/20',   text: 'text-slate-300',   icon: Loader2 },
  processing: { label: 'Processing', bg: 'bg-blue-500/20',    text: 'text-blue-300',    icon: Loader2 },
  done:       { label: 'Done',       bg: 'bg-emerald-500/20', text: 'text-emerald-300', icon: CheckCircle2 },
  error:      { label: 'Error',      bg: 'bg-red-500/20',     text: 'text-red-300',     icon: AlertCircle },
}

export function MotionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['motion-video', id],
    queryFn: () => api.get<{ motion: MotionVideo }>(`/api/motion/${id}`),
    enabled: !!id,
    refetchInterval: 3000,
  })

  const retryMutation = useMutation({
    mutationFn: () => api.post(`/api/motion/${id}/retry`, {}),
    onSuccess: () => { toast.success('Retry queued'); qc.invalidateQueries({ queryKey: ['motion-video', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/motion/${id}`),
    onSuccess: () => { toast.success('Dihapus'); navigate('/motion') },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const mv = data?.motion
  if (!mv) return <div className="text-center py-20 text-muted-foreground">Motion tidak ditemukan</div>

  const s = STATUS[mv.status]
  const Icon = s.icon
  const aspectClass = mv.aspectRatio === '9:16' ? 'aspect-[9/16]' : mv.aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video'

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/motion">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
              <PersonStanding className="h-6 w-6 text-amber-400" />
              {mv.title || `Motion #${mv.id}`}
            </h1>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge className={cn('text-xs border-0', s.bg, s.text)}>
                <Icon className={cn('h-3 w-3', mv.status === 'processing' && 'animate-spin')} />
                {s.label}
              </Badge>
              <Badge variant="outline">{mv.aspectRatio}</Badge>
              <Badge variant="outline">{mv.resolution}</Badge>
              <Badge variant="outline">Kling Motion 3</Badge>
            </div>
            <div className="text-xs text-muted-foreground/60 mt-2">{formatRelativeTime(mv.createdAt)}</div>
          </div>
          <div className="flex gap-2">
            {mv.videoUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={mv.videoUrl} download={`motion-${mv.id}.mp4`}>
                  <Download className="h-4 w-4" />
                  Download
                </a>
              </Button>
            )}
            <Button
              variant="outline" size="sm" className="text-red-400 hover:text-red-300"
              onClick={() => { if (confirm('Hapus motion video ini?')) deleteMutation.mutate() }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Generated Video */}
      <Card className="overflow-hidden">
        <div className={cn('relative bg-gradient-to-br from-amber-500/10 to-pink-500/10 mx-auto', aspectClass, 'max-h-[640px]')}>
          {mv.videoUrl ? (
            <video src={mv.videoUrl} controls poster={mv.thumbnailUrl ?? undefined} className="w-full h-full object-cover" />
          ) : mv.status === 'processing' || mv.status === 'queued' ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="h-12 w-12 text-primary/50 mx-auto animate-spin" />
                <p className="text-sm text-muted-foreground mt-3">Generating motion...</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Kling Motion 3 · ~3-8 menit</p>
                {mv.progress > 0 && <p className="text-xs text-muted-foreground/60 mt-2">{mv.progress}%</p>}
              </div>
            </div>
          ) : mv.status === 'error' ? (
            <div className="w-full h-full flex items-center justify-center px-4">
              <div className="text-center max-w-sm">
                <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
                <p className="text-sm text-red-400 mt-3">{mv.errorMsg ?? 'Error'}</p>
                <Button
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                  className="mt-4 bg-gradient-to-r from-amber-500 to-pink-500"
                >
                  {retryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Coba lagi
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2 text-sm">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Character image</div>
              <p className="font-mono text-[11px] truncate mt-1">{mv.characterImagePath.split('/').pop()}</p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Reference video</div>
              <p className="font-mono text-[11px] truncate mt-1">{mv.referenceVideoPath.split('/').pop()}</p>
            </div>
          </div>
          {mv.prompt && (
            <div className="pt-2 border-t">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Prompt tambahan</div>
              <p className="text-sm leading-relaxed">{mv.prompt}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
