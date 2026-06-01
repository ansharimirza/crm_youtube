import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Sparkles, Loader2, Copy, Check, Music2, Instagram, Youtube,
  Hash, Tag, ImageIcon, MessageSquare, Type, FileText,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getToken } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Platform, CaptionResult } from '@/lib/types'

const PLATFORMS = [
  { value: 'tiktok' as Platform, label: 'TikTok',    icon: Music2,    color: 'text-pink-400' },
  { value: 'reels' as Platform,  label: 'IG Reels',  icon: Instagram, color: 'text-purple-400' },
  { value: 'shorts' as Platform, label: 'YT Shorts', icon: Youtube,   color: 'text-red-400' },
]

interface Props {
  projectId: number
  hasScenes: boolean
}

export function CaptionGenerator({ projectId, hasScenes }: Props) {
  const [platform, setPlatform] = useState<Platform>('tiktok')
  const [language, setLanguage] = useState<'id' | 'en'>('id')
  const [result, setResult] = useState<CaptionResult | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/veo/projects/${projectId}/generate-caption`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ platform, language }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data.result as CaptionResult
    },
    onSuccess: (data) => {
      setResult(data)
      toast.success('Caption & metadata di-generate')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card className="border-yellow-500/20 bg-yellow-500/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-yellow-400" />
          AI Caption & Metadata Generator
        </CardTitle>
        <CardDescription>
          Generate caption + hashtag + thumbnail text untuk publish (research-backed, 2025 best practices)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Platform + Language selectors */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Platform Target</Label>
            <div className="grid grid-cols-3 gap-2">
              {PLATFORMS.map(({ value, label, icon: Icon, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPlatform(value)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2.5 transition-all',
                    platform === value
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/30'
                  )}
                >
                  <Icon className={cn('h-4 w-4', color)} />
                  <span className="text-xs font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Bahasa Output</Label>
            <Select value={language} onValueChange={v => setLanguage(v as 'id' | 'en')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="id">Bahasa Indonesia</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {!hasScenes && (
          <p className="text-xs text-amber-400 bg-amber-500/10 rounded p-2">
            ⚠️ Belum ada scene. Caption akan kurang akurat karena AI gak punya context konten.
          </p>
        )}

        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="w-full bg-yellow-600 hover:bg-yellow-700"
        >
          {mutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="h-4 w-4" /> Generate untuk {PLATFORMS.find(p => p.value === platform)?.label}</>
          )}
        </Button>

        {result && <CaptionResultDisplay result={result} />}
      </CardContent>
    </Card>
  )
}

function CaptionResultDisplay({ result }: { result: CaptionResult }) {
  return (
    <div className="space-y-3 pt-2 border-t">
      {/* YouTube Shorts: title first */}
      {result.title && (
        <CopyField icon={Type} label="Title" value={result.title} hint={`${result.title.length} chars (rekomendasi <40)`} large />
      )}

      {/* Caption */}
      <CopyField
        icon={MessageSquare}
        label={result.platform === 'shorts' ? 'Caption Snippet' : 'Caption'}
        value={result.caption}
        hint={`${result.caption.length} chars`}
        multiline
      />

      {/* Shorts: description */}
      {result.description && (
        <CopyField
          icon={FileText}
          label="Description"
          value={result.description}
          hint={`${result.description.length} chars (rekomendasi 300-500)`}
          multiline
        />
      )}

      {/* Cover Text */}
      {result.cover_text && (
        <CopyField
          icon={ImageIcon}
          label="Cover / Thumbnail Text"
          value={result.cover_text}
          hint={`${result.cover_text.split(/\s+/).length} kata`}
          highlight
        />
      )}

      {/* CTA */}
      <CopyField icon={Sparkles} label="CTA" value={result.cta} />

      {/* Hashtags */}
      <HashtagList icon={Hash} label="Hashtags" hashtags={result.hashtags} platform={result.platform} />

      {/* Tags (Shorts only) */}
      {result.tags && result.tags.length > 0 && (
        <TagList icon={Tag} label="YouTube Tags (backend SEO)" tags={result.tags} />
      )}

      {/* Alternative Captions */}
      {result.alternative_captions.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Alternative Captions
          </div>
          {result.alternative_captions.map((alt, i) => (
            <CopyField key={i} icon={MessageSquare} label={`Alt #${i + 1}`} value={alt} multiline compact />
          ))}
        </div>
      )}
    </div>
  )
}

function CopyField({ icon: Icon, label, value, hint, multiline, large, highlight, compact }: {
  icon: typeof Sparkles
  label: string
  value: string
  hint?: string
  multiline?: boolean
  large?: boolean
  highlight?: boolean
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      toast.success(`${label} disalin`)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn(
      'rounded-lg border p-3',
      highlight && 'border-yellow-500/30 bg-yellow-500/5',
      compact && 'p-2'
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
          {hint && <span className="text-[10px] text-muted-foreground/60">· {hint}</span>}
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={copy}>
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </Button>
      </div>
      <div className={cn(
        large ? 'text-base font-semibold' : 'text-sm',
        multiline ? 'whitespace-pre-wrap' : 'truncate',
        compact && 'text-xs',
        'leading-relaxed'
      )}>
        {value}
      </div>
    </div>
  )
}

function HashtagList({ icon: Icon, label, hashtags, platform }: {
  icon: typeof Hash
  label: string
  hashtags: string[]
  platform: Platform
}) {
  const [copied, setCopied] = useState(false)
  const joined = hashtags.join(' ')

  function copy() {
    navigator.clipboard.writeText(joined).then(() => {
      setCopied(true)
      toast.success('Hashtags disalin')
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const platformHint =
    platform === 'tiktok' ? `${hashtags.length} hashtag (rekomendasi 3-5)`
    : platform === 'reels' ? `${hashtags.length} hashtag (max 5 sejak Des 2025)`
    : `${hashtags.length} hashtag (max 5, #Shorts wajib pertama)`

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
          <span className="text-[10px] text-muted-foreground/60">· {platformHint}</span>
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={copy}>
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy All</>}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {hashtags.map((h, i) => (
          <Badge key={i} variant="secondary" className="font-mono text-xs">
            {h.startsWith('#') ? h : `#${h}`}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function TagList({ icon: Icon, label, tags }: {
  icon: typeof Tag
  label: string
  tags: string[]
}) {
  const [copied, setCopied] = useState(false)
  const joined = tags.join(', ')

  function copy() {
    navigator.clipboard.writeText(joined).then(() => {
      setCopied(true)
      toast.success('Tags disalin')
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
          <span className="text-[10px] text-muted-foreground/60">· {tags.length} tags</span>
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={copy}>
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <Badge key={i} variant="outline" className="text-xs">{t}</Badge>
        ))}
      </div>
    </div>
  )
}
