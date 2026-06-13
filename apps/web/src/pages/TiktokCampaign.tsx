import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle2, RefreshCw, Download,
  Play, Film, Sparkles, Trash2, Wand2, Image as ImageIcon, Copy as CopyIcon,
  Pencil, MessageSquare, Shuffle, Lock,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api, getToken } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { TiktokCampaign, TiktokScene, TiktokFrame, TiktokMode, TiktokContentType } from '@/lib/types'

const MODE_LABELS: Record<TiktokMode, string> = {
  ugc: 'UGC', pov_hand: 'POV Hand Review', mirror_check: 'Mirror Check',
}
const CT_LABELS: Record<TiktokContentType, string> = {
  review: 'Review', unboxing: 'Unboxing', affiliate: 'Affiliate',
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

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/tiktok/campaigns/${id}`),
    onSuccess: () => { toast.success('Campaign dihapus'); navigate('/tiktok') },
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
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Download dimulai')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Download gagal') }
    finally { setDownloading(false) }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  }

  const campaign = data?.campaign
  if (!campaign) return <div className="text-center py-20 text-muted-foreground">Campaign tidak ditemukan</div>

  const frames = campaign.frames ?? []
  const scenes = campaign.scenes ?? []
  const isDraft = campaign.status === 'draft'
  const videosReady = campaign.status === 'images_done' || campaign.status === 'generating_videos' || campaign.status === 'done'
  const eligibleForVideo = scenes.filter(s => {
    if (s.status !== 'pending' && s.status !== 'error') return false
    const sf = frames.find(f => f.id === s.startFrameId)
    const ef = frames.find(f => f.id === s.endFrameId)
    return sf?.status === 'done' && ef?.status === 'done'
  }).length

  const videosDone = scenes.filter(s => s.status === 'done').length

  return (
    <div className="space-y-6 pb-28 md:pb-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/tiktok"><ArrowLeft className="h-4 w-4" />Kembali</Link>
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
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <div className="text-xs text-muted-foreground/60 mt-2">{formatRelativeTime(campaign.createdAt)}</div>
          </div>
          <div className="flex gap-2">
            {videosDone > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadZip} disabled={downloading}>
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}ZIP
              </Button>
            )}
            <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300"
              onClick={() => { if (confirm('Hapus campaign ini?')) deleteMutation.mutate() }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {isDraft ? (
        <DraftReview campaignId={campaign.id} frames={frames} scenes={scenes} aspectRatio={campaign.aspectRatio} onUpdate={() => qc.invalidateQueries({ queryKey: ['tiktok-campaign', id] })} />
      ) : (
        <>
          <FramesGrid frames={frames} aspectRatio={campaign.aspectRatio} onUpdate={() => qc.invalidateQueries({ queryKey: ['tiktok-campaign', id] })} />
          {videosReady && (
            <ScenesSection scenes={scenes} frames={frames} aspectRatio={campaign.aspectRatio} onUpdate={() => qc.invalidateQueries({ queryKey: ['tiktok-campaign', id] })} />
          )}
        </>
      )}

      {eligibleForVideo > 0 && (
        <div className="fixed bottom-16 md:bottom-6 left-0 right-0 z-20 px-4 pointer-events-none">
          <div className="max-w-6xl mx-auto flex justify-end">
            <Card className="pointer-events-auto shadow-2xl border-pink-500/30 bg-pink-500/10 backdrop-blur">
              <CardContent className="p-3 flex items-center gap-3">
                <Sparkles className="h-4 w-4 text-pink-300" />
                <span className="text-sm">
                  <strong className="text-pink-300">{eligibleForVideo}</strong> scene siap di-generate jadi video
                </span>
                <Button onClick={() => generateVideosMutation.mutate()} disabled={generateVideosMutation.isPending}
                  className="bg-pink-600 hover:bg-pink-700" size="sm">
                  {generateVideosMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
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

function CampaignStatusBadge({ status }: { status: TiktokCampaign['status'] }) {
  const meta: Record<string, { label: string; color: string }> = {
    draft:              { label: 'DRAFT — Review',         color: 'bg-amber-500/20 text-amber-300' },
    generating_images:  { label: 'Generating Images',       color: 'bg-blue-500/20 text-blue-300' },
    images_done:        { label: 'Images Ready',            color: 'bg-emerald-500/20 text-emerald-300' },
    generating_videos:  { label: 'Generating Videos',       color: 'bg-violet-500/20 text-violet-300' },
    done:               { label: 'Done',                    color: 'bg-emerald-500/20 text-emerald-300' },
    error:              { label: 'Error',                   color: 'bg-red-500/20 text-red-300' },
  }
  const m = meta[status] ?? { label: status, color: 'bg-muted text-muted-foreground' }
  return <Badge className={cn('text-xs border-0', m.color)}>{m.label}</Badge>
}

/* ==========================================================
   DRAFT REVIEW MODE
   ========================================================== */

function DraftReview({ campaignId, frames, scenes, aspectRatio, onUpdate }: {
  campaignId: number
  frames: TiktokFrame[]
  scenes: TiktokScene[]
  aspectRatio: '9:16' | '16:9' | '1:1'
  onUpdate: () => void
}) {
  const approveMutation = useMutation({
    mutationFn: () => api.post(`/api/tiktok/campaigns/${campaignId}/approve`, {}),
    onSuccess: (res: any) => { toast.success(`${res.queued} frame di-queue`); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })

  const rerollMutation = useMutation({
    mutationFn: () => api.post(`/api/tiktok/campaigns/${campaignId}/reroll`, {}),
    onSuccess: () => { toast.success('Script di-roll ulang'); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-5">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <MessageSquare className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-amber-300">Review script + frame descriptions</p>
            <p className="text-xs text-muted-foreground mt-1">
              Claude bikin draft di bawah. Edit script atau frame description per item, atau klik <strong>Reroll</strong> untuk minta versi baru. Klik <strong>Approve</strong> kalau udah oke — frame akan di-generate jadi gambar (~5-10 menit).
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => { if (confirm('Reroll seluruh draft?')) rerollMutation.mutate() }} disabled={rerollMutation.isPending}>
            {rerollMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shuffle className="h-3 w-3" />}
            Reroll
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-semibold text-lg">Frames ({frames.length})</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {frames.map(f => <FrameDraftCard key={f.id} frame={f} onUpdate={onUpdate} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-lg">Scenes ({scenes.length})</h2>
        <div className="space-y-3">
          {scenes.map(s => (
            <SceneDraftCard
              key={s.id}
              scene={s}
              startFrame={frames.find(f => f.id === s.startFrameId)}
              endFrame={frames.find(f => f.id === s.endFrameId)}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}
          className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90">
          {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Approve & Generate Images
        </Button>
      </div>
    </div>
  )
}

function FrameDraftCard({ frame, onUpdate }: { frame: TiktokFrame; onUpdate: () => void }) {
  const [draft, setDraft] = useState(frame.imagePrompt)
  useEffect(() => setDraft(frame.imagePrompt), [frame.imagePrompt])

  const editMutation = useMutation({
    mutationFn: (v: string) => api.patch(`/api/tiktok/frames/${frame.id}`, { image_prompt: v }),
    onSuccess: () => { toast.success(`Frame ${frame.frameNumber} disimpan`); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card className="border-violet-500/20">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-300 uppercase">
          <ImageIcon className="h-3 w-3" /> Frame {frame.frameNumber}
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          className="text-xs font-mono leading-relaxed resize-none"
        />
        <Button size="sm" variant="outline" className="w-full h-8 text-xs"
          disabled={draft === frame.imagePrompt || editMutation.isPending}
          onClick={() => editMutation.mutate(draft)}>
          {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />}
          Simpan
        </Button>
      </CardContent>
    </Card>
  )
}

interface HookVariant {
  pattern_label: string
  script: string
  why_strong: string
}

function SceneDraftCard({ scene, startFrame, endFrame, onUpdate }: {
  scene: TiktokScene
  startFrame?: TiktokFrame
  endFrame?: TiktokFrame
  onUpdate: () => void
}) {
  const [script, setScript] = useState(scene.script)
  const [veoPrompt, setVeoPrompt] = useState(scene.veoPrompt)
  const [showVeo, setShowVeo] = useState(false)
  const [variants, setVariants] = useState<HookVariant[] | null>(null)
  useEffect(() => { setScript(scene.script); setVeoPrompt(scene.veoPrompt) }, [scene.id, scene.script, scene.veoPrompt])

  const editMutation = useMutation({
    mutationFn: (body: { script?: string; veo_prompt?: string }) => api.patch(`/api/tiktok/scenes/${scene.id}`, body),
    onSuccess: () => { toast.success(`Scene ${scene.sceneNumber} disimpan`); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })

  const variantsMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean; variants: HookVariant[] }>(`/api/tiktok/scenes/${scene.id}/hook-variants`, {}),
    onSuccess: (data) => { setVariants(data.variants); toast.success('3 hook variants siap') },
    onError: (e: Error) => toast.error(e.message),
  })

  const dirty = script !== scene.script || veoPrompt !== scene.veoPrompt
  const isScene1 = scene.sceneNumber === 1

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Scene {scene.sceneNumber}</div>
          <div className="text-[10px] text-muted-foreground">
            Frames: {startFrame?.frameNumber ?? '?'} → {endFrame?.frameNumber ?? '?'}
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Voice over / dialogue</label>
          <Textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={2}
            className="text-xs"
          />
        </div>

        {/* Hook variants — scene 1 only */}
        {isScene1 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wide text-amber-300 font-semibold flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Hook A/B — generate 3 alternative openers
              </div>
              <Button
                size="sm" variant="outline" className="h-7 text-[10px]"
                disabled={variantsMutation.isPending}
                onClick={() => variantsMutation.mutate()}
              >
                {variantsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                {variants ? 'Regenerate 3' : 'Generate Variants'}
              </Button>
            </div>
            {variants && (
              <div className="space-y-1.5">
                {variants.map((v, i) => (
                  <div key={i} className="rounded border bg-background/40 p-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">{v.pattern_label}</Badge>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] ml-auto"
                        onClick={() => { setScript(v.script); toast.success('Hook diganti — klik Simpan') }}
                      >
                        Pakai ini →
                      </Button>
                    </div>
                    <p className="text-xs leading-snug">{v.script}</p>
                    <p className="text-[10px] text-muted-foreground italic">💡 {v.why_strong}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button onClick={() => setShowVeo(v => !v)} className="text-[10px] text-muted-foreground hover:text-foreground">
          {showVeo ? '▾ Hide' : '▸ Show'} Veo motion prompt
        </button>
        {showVeo && (
          <Textarea
            value={veoPrompt}
            onChange={(e) => setVeoPrompt(e.target.value)}
            rows={4}
            className="text-[10px] font-mono"
          />
        )}
        <Button size="sm" variant="outline" className="w-full h-8 text-xs"
          disabled={!dirty || editMutation.isPending}
          onClick={() => editMutation.mutate({ script, veo_prompt: veoPrompt })}>
          {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />}
          Simpan
        </Button>
      </CardContent>
    </Card>
  )
}

/* ==========================================================
   FRAMES GRID — after approval
   ========================================================== */

function FramesGrid({ frames, aspectRatio, onUpdate }: {
  frames: TiktokFrame[]
  aspectRatio: '9:16' | '16:9' | '1:1'
  onUpdate: () => void
}) {
  const aspectClass = aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video'
  return (
    <div className="space-y-3">
      <h2 className="font-semibold text-lg flex items-center gap-2">
        <Lock className="h-4 w-4 text-emerald-400" />
        Frames ({frames.filter(f => f.status === 'done').length}/{frames.length})
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {frames.map(f => <FrameThumbCard key={f.id} frame={f} aspectClass={aspectClass} onUpdate={onUpdate} />)}
      </div>
    </div>
  )
}

function FrameThumbCard({ frame, aspectClass, onUpdate }: { frame: TiktokFrame; aspectClass: string; onUpdate: () => void }) {
  const [rev, setRev] = useState('')

  const reviseMutation = useMutation({
    mutationFn: (instruction: string) => api.post(`/api/tiktok/frames/${frame.id}/revise`, { instruction }),
    onSuccess: () => { toast.success(`Frame ${frame.frameNumber}: regenerating...`); setRev(''); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })

  const retryMutation = useMutation({
    mutationFn: () => api.post(`/api/tiktok/frames/${frame.id}/retry`, {}),
    onSuccess: () => { toast.success('Retry...'); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })

  const processing = frame.status === 'queued' || frame.status === 'processing'

  return (
    <Card className="overflow-hidden">
      <div className={cn('relative bg-gradient-to-br from-pink-500/5 to-violet-500/5', aspectClass)}>
        {frame.imageUrl ? (
          <img src={frame.imageUrl} className="w-full h-full object-cover" alt="" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {processing ? <Loader2 className="h-8 w-8 text-primary/50 animate-spin" />
              : frame.status === 'error' ? <AlertCircle className="h-8 w-8 text-red-400" />
              : <ImageIcon className="h-8 w-8 text-muted-foreground/30" />}
          </div>
        )}
        <div className="absolute top-1 left-1">
          <Badge className="text-[10px] bg-black/60 text-white border-0">FRAME {frame.frameNumber}</Badge>
        </div>
        {frame.imageUrl && (
          <a href={frame.imageUrl} download={`frame-${frame.frameNumber}.jpg`}
            className="absolute top-1 right-1 bg-white/90 hover:bg-white text-black rounded p-1">
            <Download className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
      <CardContent className="p-2 space-y-1.5">
        {frame.status === 'error' && (
          <>
            <p className="text-[10px] text-red-400 line-clamp-2">{frame.errorMsg}</p>
            <Button size="sm" variant="outline" className="w-full h-7 text-[10px]" onClick={() => retryMutation.mutate()}>
              <RefreshCw className="h-2.5 w-2.5" />Retry
            </Button>
          </>
        )}
        {frame.status === 'done' && (
          <div className="flex gap-1">
            <Input value={rev} onChange={(e) => setRev(e.target.value)} placeholder="Revisi..." className="h-7 text-[10px]" />
            <Button size="sm" className="h-7 text-[10px] bg-violet-600 hover:bg-violet-700"
              disabled={!rev.trim() || reviseMutation.isPending}
              onClick={() => reviseMutation.mutate(rev)}>
              {reviseMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ==========================================================
   SCENES SECTION — videos
   ========================================================== */

function ScenesSection({ scenes, frames, aspectRatio, onUpdate }: {
  scenes: TiktokScene[]
  frames: TiktokFrame[]
  aspectRatio: '9:16' | '16:9' | '1:1'
  onUpdate: () => void
}) {
  const aspectClass = aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video'
  return (
    <div className="space-y-3">
      <h2 className="font-semibold text-lg flex items-center gap-2">
        <Film className="h-4 w-4" />
        Scenes / Videos ({scenes.filter(s => s.status === 'done').length}/{scenes.length})
      </h2>
      <div className="grid md:grid-cols-2 gap-3">
        {scenes.map(s => <VideoSceneCard key={s.id} scene={s} startFrame={frames.find(f => f.id === s.startFrameId)} endFrame={frames.find(f => f.id === s.endFrameId)} aspectClass={aspectClass} onUpdate={onUpdate} />)}
      </div>
    </div>
  )
}

function VideoSceneCard({ scene, startFrame, endFrame, aspectClass, onUpdate }: {
  scene: TiktokScene
  startFrame?: TiktokFrame
  endFrame?: TiktokFrame
  aspectClass: string
  onUpdate: () => void
}) {
  const genVideoMutation = useMutation({
    mutationFn: () => api.post(`/api/tiktok/scenes/${scene.id}/generate-video`, {}),
    onSuccess: () => { toast.success(`Scene ${scene.sceneNumber}: generating video...`); onUpdate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const processing = scene.status === 'queued' || scene.status === 'processing'
  const hasVideo = scene.status === 'done' && scene.videoUrl

  return (
    <Card className="overflow-hidden">
      <div className={cn('relative bg-gradient-to-br from-pink-500/10 to-violet-500/10 max-h-[480px] mx-auto', aspectClass)}>
        {hasVideo ? (
          <video src={scene.videoUrl!} controls poster={scene.thumbnailUrl ?? undefined} className="w-full h-full object-cover" />
        ) : processing ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="h-10 w-10 text-primary/50 mx-auto animate-spin" />
              <p className="text-xs text-muted-foreground mt-2">Generating video... {scene.progress > 0 && `${scene.progress}%`}</p>
            </div>
          </div>
        ) : scene.status === 'error' ? (
          <div className="w-full h-full flex items-center justify-center px-4">
            <div className="text-center">
              <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
              <p className="text-xs text-red-400 mt-2">{scene.errorMsg}</p>
            </div>
          </div>
        ) : (
          // Pending: show start + end frame side by side
          <div className="grid grid-cols-2 gap-px h-full bg-border">
            <div className="relative bg-muted">
              {startFrame?.imageUrl ? <img src={startFrame.imageUrl} className="w-full h-full object-cover" alt="" />
                : <div className="w-full h-full flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}
              <Badge className="absolute top-1 left-1 text-[9px] bg-violet-500/40 text-violet-100 border-0">START</Badge>
            </div>
            <div className="relative bg-muted">
              {endFrame?.imageUrl ? <img src={endFrame.imageUrl} className="w-full h-full object-cover" alt="" />
                : <div className="w-full h-full flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}
              <Badge className="absolute top-1 left-1 text-[9px] bg-pink-500/40 text-pink-100 border-0">END</Badge>
            </div>
          </div>
        )}
      </div>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Scene {scene.sceneNumber}</span>
          <span className="text-[10px] text-muted-foreground">{scene.duration}s</span>
        </div>
        <p className="text-xs leading-relaxed line-clamp-3">{scene.script}</p>
        <div className="flex items-center gap-1.5">
          {(scene.status === 'pending' || scene.status === 'error') && startFrame?.status === 'done' && endFrame?.status === 'done' && (
            <Button size="sm" className="flex-1 h-8 text-xs bg-pink-600 hover:bg-pink-700"
              onClick={() => genVideoMutation.mutate()} disabled={genVideoMutation.isPending}>
              {genVideoMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Generate Video
            </Button>
          )}
          {hasVideo && (
            <Button asChild size="sm" variant="outline" className="flex-1 h-8 text-xs">
              <a href={scene.videoUrl!} download={`scene-${scene.sceneNumber}.mp4`}>
                <Download className="h-3 w-3" />Download
              </a>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-8 text-[10px]"
            onClick={() => { navigator.clipboard.writeText(scene.script); toast.success('Script disalin') }}>
            <CopyIcon className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
