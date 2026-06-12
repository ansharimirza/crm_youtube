import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, Sparkles, X, ImagePlus, Film,
  RectangleVertical, Square as SquareIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { getToken } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const ASPECT_RATIOS = [
  { value: '9:16' as const, label: '9:16', desc: 'Vertical', icon: RectangleVertical },
  { value: '1:1' as const,  label: '1:1',  desc: 'Square',    icon: SquareIcon },
  { value: '16:9' as const, label: '16:9', desc: 'Landscape', icon: RectangleVertical },
]
const DURATIONS = [5, 10]

export function MotionNewPage() {
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [characterImage, setCharacterImage] = useState<File | null>(null)
  const [characterPreview, setCharacterPreview] = useState<string | null>(null)
  const [referenceVideo, setReferenceVideo] = useState<File | null>(null)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '1:1' | '16:9'>('9:16')
  const [duration, setDuration] = useState(5)

  function handleCharacter(file: File | null) {
    if (!file) return
    setCharacterImage(file)
    const reader = new FileReader()
    reader.onload = (e) => setCharacterPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      if (title.trim()) fd.append('title', title.trim())
      fd.append('character_image', characterImage!)
      fd.append('reference_video', referenceVideo!)
      if (prompt.trim()) fd.append('prompt', prompt.trim())
      fd.append('aspect_ratio', aspectRatio)
      fd.append('duration', String(duration))

      const res = await fetch('/api/motion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success('Motion video sedang di-generate!')
      navigate(`/motion/${data.motion.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canSubmit = !!characterImage && !!referenceVideo

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/motion">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Buat Motion Video</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Karakter dari foto akan meniru gerakan dari video referensi
        </p>
      </div>

      {/* Title */}
      <Card>
        <CardContent className="p-5 space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Judul (opsional)</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Cth: Dance challenge"
            maxLength={200}
          />
        </CardContent>
      </Card>

      {/* Character Image */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              1. Foto Karakter <span className="text-red-400">*</span>
            </Label>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              Siapa yang akan dianimasikan — identitas wajah & pakaian dari foto ini akan dipertahankan
            </p>
          </div>
          {characterPreview ? (
            <div className="relative inline-block">
              <img src={characterPreview} className="rounded-lg max-h-72 border" alt="" />
              <Button
                type="button" size="icon" variant="secondary"
                className="absolute top-2 right-2 h-7 w-7"
                onClick={() => { setCharacterImage(null); setCharacterPreview(null) }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 aspect-[9/16] max-w-xs border-2 border-dashed border-amber-500/30 rounded-lg cursor-pointer hover:bg-amber-500/5">
              <ImagePlus className="h-8 w-8 text-muted-foreground/50" />
              <p className="font-medium text-sm">Upload foto karakter</p>
              <p className="text-xs text-muted-foreground">JPG / PNG, full body lebih baik</p>
              <input
                type="file" accept="image/*" className="hidden"
                onChange={(e) => handleCharacter(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </CardContent>
      </Card>

      {/* Reference Video */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              2. Video Referensi <span className="text-red-400">*</span>
            </Label>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              Gerakan yang akan ditiru — MP4/MOV/WebM, max 100MB, max 120 detik
            </p>
          </div>
          {referenceVideo ? (
            <div className="relative inline-block">
              <video
                src={URL.createObjectURL(referenceVideo)}
                controls
                className="rounded-lg max-h-64 border"
              />
              <Button
                type="button" size="icon" variant="secondary"
                className="absolute top-2 right-2 h-7 w-7"
                onClick={() => setReferenceVideo(null)}
              >
                <X className="h-3 w-3" />
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                {referenceVideo.name} · {(referenceVideo.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 aspect-video max-w-md border-2 border-dashed border-pink-500/30 rounded-lg cursor-pointer hover:bg-pink-500/5">
              <Film className="h-8 w-8 text-muted-foreground/50" />
              <p className="font-medium text-sm">Upload video gerakan</p>
              <p className="text-xs text-muted-foreground">MP4 / MOV / WebM</p>
              <input
                type="file" accept="video/mp4,video/mov,video/webm,video/quicktime" className="hidden"
                onChange={(e) => setReferenceVideo(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </CardContent>
      </Card>

      {/* Prompt + Settings */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Prompt tambahan (opsional)
            </Label>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 mb-2">
              Konteks tambahan — lighting, mood, environment
            </p>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Cth: cinematic warm lighting, studio backdrop, smooth professional shot"
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Aspect Ratio</Label>
              <div className="grid grid-cols-3 gap-2">
                {ASPECT_RATIOS.map(({ value, label, desc, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAspectRatio(value)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border p-3',
                      aspectRatio === value ? 'border-primary bg-primary/5' : 'border-border'
                    )}
                  >
                    <Icon className={cn('h-4 w-4', value === '16:9' && 'rotate-90')} />
                    <span className="text-xs font-medium">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Duration</Label>
              <div className="grid grid-cols-2 gap-2">
                {DURATIONS.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={cn(
                      'rounded-lg border p-3 text-sm font-medium transition-colors',
                      duration === d ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/30'
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={() => mutation.mutate()}
          disabled={!canSubmit || mutation.isPending}
          className="bg-gradient-to-r from-amber-500 to-pink-500 hover:opacity-90"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate Motion Video
        </Button>
      </div>
    </div>
  )
}
