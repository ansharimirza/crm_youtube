import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Loader2, CheckCircle2, AlertCircle,
  Film, Video, KeyRound, ExternalLink,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth'
import type { TiktokCampaignSummary, TiktokMode, TiktokContentType } from '@/lib/types'

const MODE_BADGES: Record<TiktokMode, { label: string; bg: string; text: string }> = {
  ugc:           { label: 'UGC',          bg: 'bg-violet-500/20',  text: 'text-violet-300' },
  pov_hand:      { label: 'POV Hand',     bg: 'bg-amber-500/20',   text: 'text-amber-300' },
  mirror_check:  { label: 'Mirror Check', bg: 'bg-cyan-500/20',    text: 'text-cyan-300' },
}

const CT_BADGES: Record<TiktokContentType, { label: string; bg: string; text: string }> = {
  review:    { label: 'Review',    bg: 'bg-blue-500/20',    text: 'text-blue-300' },
  unboxing:  { label: 'Unboxing',  bg: 'bg-emerald-500/20', text: 'text-emerald-300' },
  affiliate: { label: 'Affiliate', bg: 'bg-rose-500/20',    text: 'text-rose-300' },
}

export function TiktokStudioPage() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['tiktok-campaigns'],
    queryFn: () => api.get<{ campaigns: TiktokCampaignSummary[] }>('/api/tiktok/campaigns'),
    refetchInterval: 5000,
  })
  const campaigns = data?.campaigns ?? []

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/tiktok/campaigns/${id}`),
    onSuccess: () => {
      toast.success('Campaign dihapus')
      qc.invalidateQueries({ queryKey: ['tiktok-campaigns'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Video className="h-6 w-6 text-pink-400" />
            TikTok Studio
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-normal">
              powered by Claude
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate TikTok/Reels video campaigns: UGC, POV Hand Review, Mirror Check
          </p>
        </div>
        <Button asChild>
          <Link to="/tiktok/new">
            <Plus className="h-4 w-4" />
            New Campaign
          </Link>
        </Button>
      </div>

      {/* Anthropic key warning */}
      {!user?.hasAnthropicKey && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <KeyRound className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-amber-300">Anthropic API Key belum diatur</p>
                <p className="text-muted-foreground text-xs mt-1">
                  TikTok Studio butuh Claude untuk generate script. Daftar di{' '}
                  <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    console.anthropic.com
                  </a>{' '}
                  ($5 free credit), lalu set di Settings.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/settings">Ke Settings →</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Video className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">Belum ada campaign</p>
            <Button asChild className="mt-4" size="sm">
              <Link to="/tiktok/new">
                <Plus className="h-4 w-4" />
                Buat Campaign Pertama
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map(c => {
            const modeStyle = MODE_BADGES[c.mode]
            const ctStyle = CT_BADGES[c.contentType]
            const activity = c.processingCount > 0
            return (
              <Card key={c.id} className="hover:border-primary/40 transition-colors group">
                <CardContent className="p-0">
                  <Link to={`/tiktok/${c.id}`} className="block">
                    <div className="relative aspect-[9/16] sm:aspect-video bg-gradient-to-br from-pink-500/10 to-violet-500/10 rounded-t-xl overflow-hidden">
                      {c.thumbnail ? (
                        <img src={c.thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="h-12 w-12 text-primary/40" />
                        </div>
                      )}
                      {activity && (
                        <div className="absolute top-2 right-2 bg-blue-500/90 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {c.processingCount}
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 flex gap-1.5">
                        <Badge className={cn('text-xs', modeStyle.bg, modeStyle.text, 'border-0')}>
                          {modeStyle.label}
                        </Badge>
                        <Badge className={cn('text-xs', ctStyle.bg, ctStyle.text, 'border-0')}>
                          {ctStyle.label}
                        </Badge>
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-medium truncate group-hover:text-primary transition-colors">
                        {c.title}
                      </h3>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {c.productName}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3">
                        <span>{c.sceneCount} scene</span>
                        {c.doneCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            {c.doneCount}
                          </span>
                        )}
                        {c.errorCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-red-400">
                            <AlertCircle className="h-3 w-3" />
                            {c.errorCount}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground/60 mt-1">
                        {formatRelativeTime(c.createdAt)}
                      </div>
                    </div>
                  </Link>
                  <div className="border-t flex items-center justify-end gap-1 px-2 py-1">
                    <Button asChild size="sm" variant="ghost" className="h-8">
                      <Link to={`/tiktok/${c.id}`}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Buka
                      </Link>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => {
                        if (confirm(`Hapus campaign "${c.title}"?`)) deleteMutation.mutate(c.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
