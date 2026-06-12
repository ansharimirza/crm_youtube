import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Loader2, CheckCircle2, AlertCircle, PersonStanding, Film } from 'lucide-react'
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

export function MotionStudioPage() {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['motion-videos'],
    queryFn: () => api.get<{ videos: MotionVideo[] }>('/api/motion'),
    refetchInterval: 4000,
  })
  const videos = data?.videos ?? []

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/motion/${id}`),
    onSuccess: () => {
      toast.success('Motion video dihapus')
      qc.invalidateQueries({ queryKey: ['motion-videos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <PersonStanding className="h-6 w-6 text-amber-400" />
            Motion Studio
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-normal">
              Kling Motion 3
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Animate any character using motion from a reference video
          </p>
        </div>
        <Button asChild className="bg-gradient-to-r from-amber-500 to-pink-500 hover:opacity-90">
          <Link to="/motion/new">
            <Plus className="h-4 w-4" />
            New Motion
          </Link>
        </Button>
      </div>

      {videos.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <PersonStanding className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">Belum ada motion video</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">
              Upload 1 foto karakter + 1 video referensi → AI bikin karakter kamu ngikutin gerakan video itu
            </p>
            <Button asChild className="mt-4 bg-gradient-to-r from-amber-500 to-pink-500" size="sm">
              <Link to="/motion/new">
                <Plus className="h-4 w-4" />
                Buat Motion Pertama
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map(mv => {
            const s = STATUS[mv.status]
            const Icon = s.icon
            const aspectClass = mv.aspectRatio === '9:16' ? 'aspect-[9/16]' : mv.aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video'
            return (
              <Card key={mv.id} className="hover:border-primary/40 transition-colors group overflow-hidden">
                <Link to={`/motion/${mv.id}`} className="block">
                  <div className={cn('relative bg-gradient-to-br from-amber-500/10 to-pink-500/10', aspectClass)}>
                    {mv.videoUrl ? (
                      <video src={mv.videoUrl} poster={mv.thumbnailUrl ?? undefined} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Icon className={cn('h-10 w-10', s.text, mv.status === 'processing' && 'animate-spin')} />
                      </div>
                    )}
                    <div className="absolute top-2 left-2">
                      <Badge className={cn('text-[10px] border-0', s.bg, s.text)}>
                        <Icon className={cn('h-3 w-3', mv.status === 'processing' && 'animate-spin')} />
                        {s.label}
                      </Badge>
                    </div>
                    {mv.status === 'processing' && mv.progress > 0 && (
                      <div className="absolute top-2 right-2">
                        <Badge className="text-[10px] bg-blue-500/20 text-blue-300 border-0">{mv.progress}%</Badge>
                      </div>
                    )}
                  </div>
                  <CardContent className="p-3">
                    <h3 className="font-medium truncate">{mv.title || `Motion #${mv.id}`}</h3>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                      <span>{mv.aspectRatio}</span>
                      <span>·</span>
                      <span>{mv.duration}s</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 mt-2">
                      {formatRelativeTime(mv.createdAt)}
                    </div>
                  </CardContent>
                </Link>
                <div className="border-t flex items-center justify-end px-2 py-1">
                  <Button
                    size="icon" variant="ghost"
                    className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => { if (confirm(`Hapus motion video ini?`)) deleteMutation.mutate(mv.id) }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex gap-3">
          <Film className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-medium text-amber-300">Cara kerjanya:</p>
            <p className="text-muted-foreground">
              Upload <strong>1 foto karakter</strong> (siapa yang dianimasikan) + <strong>1 video referensi</strong> (gerakan yang akan ditiru) → Kling Motion 3 menggabungkan: identitas dari foto, gerakan dari video.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
