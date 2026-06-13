import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle2, RefreshCw, Download,
  Play, Film, Sparkles, Trash2, Wand2, Image as ImageIcon, Copy as CopyIcon,
  Pencil, X, ChevronDown, ChevronUp, MessageSquare,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { api, getToken } from '@/lib/api'
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

export function TiktokCampaignPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['tiktok-campaign', id],
    queryFn: () => api.get<{ campaign: TiktokCampaign }>(`/api/tiktok/campaigns/${id}`),
    enabled: !!id,
    refetchInterval: 4000,
  })

  const generateVideosMutation = useMutation({
    mutationFn: () => api.post(`/api/tiktok/campaigns/${id}/generate-videos`, {}),
    onSuccess: (res: any) => {
      toast.success(`${res.queued} scene di-queue untuk video generation`)
      qc.invalidateQueries({ queryKey: ['tiktok-campaign', id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [downloading, setDownloading] = useState(false)
  async function handleDownloadZip() {
    if (!data?.campaign) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/tiktok/campaigns/${id}/download-zip`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${data.campaign.title.replace(/[^\w\s-]/g, '').trim() || 'tiktok-campaign'}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Download dimulai')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download gagal')
    } finally {
      setDownloading(false)
    }
  }

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
    return <div className="text-center py-20 text-muted-foreground">Campaign tidak ditemukan</div>
  }

  const scenes = campaign.scenes ?? []
  const imagesDone = scenes.filter(s => s.imageStatus === 'done').length
  const imagesProcessing = scenes.filter(s => s.imageStatus === 'processing' || s.imageStatus === 'queued').length
  const imagesError = scenes.filter(s => s.imageStatus === 'error').length

  const videosDone = scenes.filter(s => s.status === 'done').length
  const videosProcessing = scenes.filter(s => s.status === 'processing' || s.status === 'queued').length
  const eligibleForVideo = scenes.filter(s => s.imageStatus === 'done' && (s.status === 'pending' || s.status === 'error')).length

  const allImagesDone = imagesDone === scenes.length && scenes.length > 0

  return (
    <div className="space-y-6 pb-28 md:pb-6">
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
            <div className="text-xs text-muted-foreground/60 mt-2">{formatRelativeTime(campaign.createdAt)}</div>
          </div>
          <div className="flex gap-2">
            {videosDone > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadZip} disabled={downloading}>
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                ZIP
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
          <Stat label="Image Ready" value={imagesDone} sub={imagesProcessing > 0 ? `+${imagesProcessing} processing` : undefined} color="text-emerald-400" />
          <Stat label="Video Ready" value={videosDone} sub={videosProcessing > 0 ? `+${videosProcessing} processing` : undefined} color="text-blue-400" />
          <Stat label="Errors" value={imagesError + scenes.filter(s => s.status === 'error').length} color="text-red-400" />
        </CardContent>
      </Card>

      {/* Scenes grid */}
      <div>
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Film className="h-4 w-4" />
          Scenes ({scenes.length})
          {!allImagesDone && imagesProcessing > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              · Generating image preview...
            </span>
          )}
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {scenes.map(scene => (
            <SceneCard
              key={scene.id}
              scene={scene}
              aspectRatio={campaign.aspectRatio}
              onUpdate={() => qc.invalidateQueries({ queryKey: ['tiktok-campaign', id] })}
            />
          ))}
        </div>
      </div>

      {/* Sticky bottom: Generate All Videos */}
      {eligibleForVideo > 0 && (
        <div className="fixed bottom-16 md:bottom-6 left-0 right-0 z-20 px-4 pointer-events-none">
          <div className="max-w-6xl mx-auto flex justify-end">
            <Card className="pointer-events-auto shadow-2xl border-pink-500/30 bg-pink-500/10 backdrop-blur">
              <CardContent className="p-3 flex items-center gap-3">
                <Sparkles className="h-4 w-4 text-pink-300" />
                <span className="text-sm">
                  <strong className="text-pink-300">{eligibleForVideo}</strong> scene siap di-generate jadi video
                </span>
                <Button
                  onClick={() => generateVideosMutation.mutate()}
                  disabled={generateVideosMutation.isPending}
                  className="bg-pink-600 hover:bg-pink-700"
                  size="sm"
                >
                  {generateVideosMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate All Videos
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function FramePanel({ label, aspectClass, imageUrl, status, errorMsg, sceneNumber, vidProgress }: {
  label: 'START' | 'END'
  aspectClass: string
  imageUrl: string | null
  status: 'queued' | 'processing' | 'done' | 'error'
  errorMsg: string | null
  sceneNumber: number
  vidProgress?: number
}) {
  const processing = status === 'queued' || status === 'processing'
  return (
    <div className={cn('relative bg-gradient-to-br from-pink-500/5 to-violet-500/5', aspectClass)}>
      {imageUrl ? (
        <img src={imageUrl} className="w-full h-full object-cover" alt="" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {processing ? (
            <div className="text-center">
              <Loader2 className="h-7 w-7 text-primary/50 mx-auto animate-spin" />
              <p className="text-[10px] text-muted-foreground mt-1">{label}...</p>
            </div>
          ) : status === 'error' ? (
            <div className="text-center px-2">
              <AlertCircle className="h-7 w-7 text-red-400 mx-auto" />
              <p className="text-[9px] text-red-400 mt-1 line-clamp-2">{errorMsg ?? 'Error'}</p>
            </div>
          ) : (
            <ImageIcon className="h-7 w-7 text-muted-foreground/30" />
          )}
        </div>
      )}
      <div className="absolute top-1 left-1 flex gap-1">
        <Badge className={cn('text-[9px] px-1.5 py-0 border-0',
          label === 'START' ? 'bg-violet-500/40 text-violet-100' : 'bg-pink-500/40 text-pink-100'
        )}>
          {label}
        </Badge>
        {label === 'START' && (
          <Badge className="text-[9px] px-1.5 py-0 bg-black/60 text-white border-0">
            S{String(sceneNumber).padStart(2, '0')}
          </Badge>
        )}
        {processing && (
          <Badge className="text-[9px] px-1.5 py-0 bg-blue-500/40 text-blue-100 border-0">
            <Loader2 className="h-2 w-2 animate-spin" />
          </Badge>
        )}
        {vidProgress !== undefined && label === 'START' && (
          <Badge className="text-[9px] px-1.5 py-0 bg-purple-500/40 text-purple-100 border-0">
            VID {vidProgress}%
          </Badge>
        )}
      </div>
      {imageUrl && (
        <a
          href={imageUrl}
          download={`scene-${sceneNumber}-${label.toLowerCase()}.jpg`}
          className="absolute top-1 right-1 bg-white/90 hover:bg-white text-black rounded p-1"
        >
          <Download className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div>
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
    </div>
  )
}

function SceneCard({
  scene, aspectRatio, onUpdate,
}: {
  scene: TiktokScene
  aspectRatio: '9:16' | '16:9' | '1:1'
  onUpdate: () => void
}) {
  const [revStart, setRevStart] = useState('')
  const [revEnd, setRevEnd] = useState('')
  const [scriptDraft, setScriptDraft] = useState(scene.script)
  const [voiceOn, setVoiceOn] = useState(true)
  const [showPrompt, setShowPrompt] = useState(false)

  const aspectClass = aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video'

  const reviseStartMutation = useMutation({
    mutationFn: (instruction: string) =>
      api.post(`/api/tiktok/scenes/${scene.id}/revise-image`, { instruction, frame: 'start' }),
    onSuccess: () => {
      toast.success(`Scene ${scene.sceneNumber} start frame: regenerating...`)
      setRevStart('')
      onUpdate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reviseEndMutation = useMutation({
    mutationFn: (instruction: string) =>
      api.post(`/api/tiktok/scenes/${scene.id}/revise-image`, { instruction, frame: 'end' }),
    onSuccess: () => {
      toast.success(`Scene ${scene.sceneNumber} end frame: regenerating...`)
      setRevEnd('')
      onUpdate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateScriptMutation = useMutation({
    mutationFn: (script: string) =>
      api.patch(`/api/tiktok/scenes/${scene.id}/script`, { script }),
    onSuccess: () => {
      toast.success(`Script scene ${scene.sceneNumber} disimpan`)
      onUpdate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const retryImageMutation = useMutation({
    mutationFn: () => api.post(`/api/tiktok/scenes/${scene.id}/retry-image`, {}),
    onSuccess: () => { toast.success('Retry image...'); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })

  const genVideoMutation = useMutation({
    mutationFn: () => api.post(`/api/tiktok/scenes/${scene.id}/generate-video`, {}),
    onSuccess: () => { toast.success(`Scene ${scene.sceneNumber}: generating video...`); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })

  const startProcessing = scene.imageStatus === 'processing' || scene.imageStatus === 'queued'
  const endProcessing = scene.endImageStatus === 'processing' || scene.endImageStatus === 'queued'
  const vidProcessing = scene.status === 'processing' || scene.status === 'queued'
  const hasVideo = scene.status === 'done' && scene.videoUrl
  const bothFramesDone = scene.imageStatus === 'done' && scene.endImageStatus === 'done'

  return (
    <Card className="overflow-hidden">
      {/* If video done, show just the video */}
      {hasVideo ? (
        <div className={cn('relative bg-gradient-to-br from-pink-500/10 to-violet-500/10 max-h-[480px] mx-auto', aspectClass)}>
          <video src={scene.videoUrl!} controls poster={scene.thumbnailUrl ?? scene.imageUrl ?? undefined} className="w-full h-full object-cover" />
          <div className="absolute top-2 left-2 flex gap-1.5">
            <Badge className="text-[10px] bg-black/60 text-white border-0">SCENE {String(scene.sceneNumber).padStart(2, '0')}</Badge>
            <Badge className="text-[10px] bg-emerald-500/30 text-emerald-200 border-0">
              <Play className="h-2.5 w-2.5" /> VIDEO
            </Badge>
          </div>
        </div>
      ) : (
        // Show two frames side by side: start | end
        <div className="grid grid-cols-2 gap-px bg-border">
          <FramePanel
            label="START"
            aspectClass={aspectClass}
            imageUrl={scene.imageUrl}
            status={scene.imageStatus}
            errorMsg={scene.imageErrorMsg}
            sceneNumber={scene.sceneNumber}
            vidProgress={vidProcessing ? scene.progress : undefined}
          />
          <FramePanel
            label="END"
            aspectClass={aspectClass}
            imageUrl={scene.endImageUrl}
            status={scene.endImageStatus}
            errorMsg={scene.endImageErrorMsg}
            sceneNumber={scene.sceneNumber}
          />
        </div>
      )}

      <CardContent className="p-3 space-y-3">
        {/* Revisi START Frame */}
        {!hasVideo && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300 uppercase tracking-wide">
              <Wand2 className="h-3.5 w-3.5" />
              Revisi Start Frame
            </div>
            <div className="flex gap-2">
              <Input
                value={revStart}
                onChange={(e) => setRevStart(e.target.value)}
                placeholder="Cth: senyum lebih lebar, angle dari atas..."
                className="text-xs h-9 bg-background/50"
                disabled={startProcessing}
              />
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-700 h-9"
                disabled={startProcessing || !revStart.trim()}
                onClick={() => reviseStartMutation.mutate(revStart)}
              >
                {reviseStartMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'REVISI'}
              </Button>
            </div>
          </div>
        )}

        {/* Revisi END Frame */}
        {!hasVideo && (
          <div className="rounded-lg border border-pink-500/30 bg-pink-500/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-pink-300 uppercase tracking-wide">
              <Wand2 className="h-3.5 w-3.5" />
              Revisi End Frame
            </div>
            <div className="flex gap-2">
              <Input
                value={revEnd}
                onChange={(e) => setRevEnd(e.target.value)}
                placeholder="Cth: pegang produk di tangan, mata ke kamera..."
                className="text-xs h-9 bg-background/50"
                disabled={endProcessing}
              />
              <Button
                size="sm"
                className="bg-pink-600 hover:bg-pink-700 h-9"
                disabled={endProcessing || !revEnd.trim()}
                onClick={() => reviseEndMutation.mutate(revEnd)}
              >
                {reviseEndMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'REVISI'}
              </Button>
            </div>
          </div>
        )}

        {/* Voice over (script) */}
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
              <MessageSquare className="h-3.5 w-3.5" />
              Voice Over {voiceOn ? 'ON' : 'OFF'}
            </div>
            <Switch checked={voiceOn} onCheckedChange={setVoiceOn} />
          </div>
          <Textarea
            value={scriptDraft}
            onChange={(e) => setScriptDraft(e.target.value)}
            rows={3}
            className="text-xs leading-relaxed resize-none"
            disabled={!voiceOn}
          />
          <Button
            size="sm" variant="outline" className="w-full h-8 text-xs"
            disabled={scriptDraft === scene.script || updateScriptMutation.isPending}
            onClick={() => updateScriptMutation.mutate(scriptDraft)}
          >
            {updateScriptMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Pencil className="h-3 w-3" />
            )}
            UPDATE PROMPT
          </Button>
        </div>

        {/* Prompt toggle */}
        <button
          onClick={() => setShowPrompt(v => !v)}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 border rounded-md"
        >
          <CopyIcon className="h-3 w-3" />
          PROMPT
          {showPrompt ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showPrompt && (
          <div className="text-[11px] font-mono">
            <div className="text-muted-foreground mb-1 flex items-center justify-between">
              <span>Veo Prompt</span>
              <button
                className="text-primary hover:underline"
                onClick={() => { navigator.clipboard.writeText(scene.veoPrompt); toast.success('Copied') }}
              >copy</button>
            </div>
            <div className="p-2 bg-muted/30 rounded leading-relaxed max-h-40 overflow-auto">{scene.veoPrompt}</div>
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-1.5 pt-1">
          {scene.imageStatus === 'error' && (
            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => retryImageMutation.mutate()}>
              <RefreshCw className="h-3 w-3" />
              Retry Image
            </Button>
          )}
          {bothFramesDone && (scene.status === 'pending' || scene.status === 'error') && (
            <Button
              size="sm" className="flex-1 h-8 text-xs bg-pink-600 hover:bg-pink-700"
              onClick={() => genVideoMutation.mutate()}
              disabled={genVideoMutation.isPending}
            >
              {genVideoMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Generate Video
            </Button>
          )}
          {hasVideo && (
            <Button asChild size="sm" variant="outline" className="flex-1 h-8 text-xs">
              <a href={scene.videoUrl!} download={`scene-${scene.sceneNumber}.mp4`}>
                <Download className="h-3 w-3" />
                Download Video
              </a>
            </Button>
          )}
          {scene.status === 'error' && (
            <span className="text-[10px] text-red-400 line-clamp-1 flex-1">{scene.errorMsg}</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
