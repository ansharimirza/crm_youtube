import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, Trash2, Edit3, Play, ExternalLink, Video as VideoIcon, CheckCircle2, Loader2, AlertCircle, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { StatusBadge } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { Video } from '@/lib/types'

export function DashboardPage() {
  const qc = useQueryClient()

  const { data, refetch, isFetching } = useQuery({
    queryKey: ['videos'],
    queryFn: () => api.get<{ videos: Video[] }>('/api/videos'),
    refetchInterval: 5000,
  })

  const { data: workerHealth } = useQuery({
    queryKey: ['worker-health'],
    queryFn: () => api.get<{ worker: 'online' | 'offline' }>('/api/system/worker-health'),
    refetchInterval: 30000,
  })

  const startMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/videos/${id}/start`),
    onSuccess: () => {
      toast.success('Upload dimulai')
      qc.invalidateQueries({ queryKey: ['videos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/videos/${id}`),
    onSuccess: () => {
      toast.success('Video dihapus')
      qc.invalidateQueries({ queryKey: ['videos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const videos = data?.videos ?? []
  const stats = {
    total: videos.length,
    done: videos.filter(v => v.status === 'done').length,
    uploading: videos.filter(v => v.status === 'uploading').length,
    queued: videos.filter(v => ['queued', 'scheduled'].includes(v.status)).length,
    error: videos.filter(v => v.status === 'error').length,
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola semua video YouTube kamu</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            Refresh
          </Button>
          <Button asChild>
            <Link to="/upload">
              <Plus className="h-4 w-4" />
              Upload Video
            </Link>
          </Button>
        </div>
      </div>

      {/* Worker status banner */}
      {workerHealth && (
        <div className={cn(
          'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm',
          workerHealth.worker === 'online'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        )}>
          <div className={cn('h-2 w-2 rounded-full', workerHealth.worker === 'online' ? 'bg-emerald-400' : 'bg-amber-400')} />
          <span className="font-medium">Worker VPS US:</span>
          <span className="capitalize">{workerHealth.worker}</span>
          {workerHealth.worker === 'offline' && (
            <span className="text-xs opacity-80">— Upload akan gagal sampai worker online</span>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={VideoIcon}     label="Total"     value={stats.total}     color="text-foreground" />
        <StatCard icon={CheckCircle2}  label="Selesai"   value={stats.done}      color="text-emerald-400" />
        <StatCard icon={Loader2}       label="Uploading" value={stats.uploading} color="text-blue-400" spin={stats.uploading > 0} />
        <StatCard icon={AlertCircle}   label="Error"     value={stats.error}     color="text-red-400" />
      </div>

      {/* Video list */}
      <Card>
        <CardHeader>
          <CardTitle>Video</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {videos.length === 0 ? (
            <div className="py-16 text-center">
              <VideoIcon className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground">Belum ada video</p>
              <Button asChild className="mt-4" size="sm">
                <Link to="/upload">
                  <Plus className="h-4 w-4" />
                  Upload Video Pertama
                </Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {videos.map((v) => (
                <VideoRow
                  key={v.id}
                  video={v}
                  onStart={() => startMutation.mutate(v.id)}
                  onDelete={() => {
                    if (confirm(`Hapus "${v.title}"?`)) deleteMutation.mutate(v.id)
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color, spin }: {
  icon: typeof VideoIcon
  label: string
  value: number
  color: string
  spin?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center">
            <Icon className={cn('h-5 w-5', color, spin && 'animate-spin')} />
          </div>
          <div>
            <div className={cn('text-2xl font-bold', color)}>{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function VideoRow({ video, onStart, onDelete }: {
  video: Video
  onStart: () => void
  onDelete: () => void
}) {
  const showStart = ['queued', 'error', 'scheduled'].includes(video.status)
  const isUploading = video.status === 'uploading'

  return (
    <div className="px-5 py-4 hover:bg-accent/30 transition-colors">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shrink-0">
          <VideoIcon className="h-5 w-5 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium truncate">{video.title}</h3>
            <StatusBadge status={video.status} />
          </div>

          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            {video.youtubeAccount && (
              <>
                <span className="inline-flex items-center gap-1 text-primary">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  {video.youtubeAccount.channelTitle || video.youtubeAccount.email}
                </span>
                <span>•</span>
              </>
            )}
            <span className="truncate max-w-[200px]">{video.fileName}</span>
            {video.fileSize && <><span>•</span><span>{formatBytes(video.fileSize)}</span></>}
            <span>•</span>
            <span className="capitalize">{video.privacy}</span>
            <span>•</span>
            <span>{formatRelativeTime(video.createdAt)}</span>
            {video.scheduledAt && (
              <>
                <span>•</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(video.scheduledAt).toLocaleString('id-ID')}
                </span>
              </>
            )}
          </div>

          {isUploading && (
            <div className="mt-2 flex items-center gap-2">
              <Progress value={video.progress} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground">{video.progress}%</span>
            </div>
          )}

          {video.youtubeUrl && (
            <a
              href={video.youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1.5"
            >
              <ExternalLink className="h-3 w-3" />
              {video.youtubeUrl}
            </a>
          )}

          {video.errorMsg && (
            <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
              {video.errorMsg}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {showStart && (
            <Button onClick={onStart} size="sm" variant="ghost" title="Upload sekarang">
              <Play className="h-4 w-4" />
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" title="Edit">
            <Link to={`/upload?edit=${video.id}`}>
              <Edit3 className="h-4 w-4" />
            </Link>
          </Button>
          {!isUploading && (
            <Button onClick={onDelete} size="sm" variant="ghost" title="Hapus" className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
