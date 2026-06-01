import { useState, useEffect, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, X, Save, RotateCw, Sparkles, Wand2, Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getToken } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { VeoScene, VeoModel, VeoResolution, VeoAspectRatio } from '@/lib/types'

interface Props {
  scene: VeoScene | null
  open: boolean
  onClose: () => void
  projectId: number
}

export function EditSceneDialog({ scene, open, onClose, projectId }: Props) {
  const qc = useQueryClient()

  const [prompt, setPrompt] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [model, setModel] = useState<VeoModel>('veo-2')
  const [resolution, setResolution] = useState<VeoResolution>('720p')
  const [aspectRatio, setAspectRatio] = useState<VeoAspectRatio>('16:9')
  const [duration, setDuration] = useState(4)

  const [firstImage, setFirstImage] = useState<File | null>(null)
  const [firstPreview, setFirstPreview] = useState<string | null>(null)
  const [clearFirst, setClearFirst] = useState(false)

  const [lastImage, setLastImage] = useState<File | null>(null)
  const [lastPreview, setLastPreview] = useState<string | null>(null)
  const [clearLast, setClearLast] = useState(false)

  useEffect(() => {
    if (scene) {
      setPrompt(scene.prompt)
      setImagePrompt(scene.imagePrompt ?? '')
      setModel(scene.model)
      setResolution(scene.resolution)
      setAspectRatio(scene.aspectRatio)
      setDuration(scene.duration)
      setFirstImage(null)
      setFirstPreview(null)
      setClearFirst(false)
      setLastImage(null)
      setLastPreview(null)
      setClearLast(false)
    }
  }, [scene])

  function previewFile(file: File | null, setPreview: (v: string | null) => void) {
    if (!file) { setPreview(null); return }
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const mutation = useMutation({
    mutationFn: async ({ regenerate }: { regenerate: boolean }) => {
      if (!scene) throw new Error('No scene')
      const fd = new FormData()
      fd.append('prompt', prompt)
      fd.append('image_prompt', imagePrompt)
      fd.append('model', model)
      fd.append('resolution', resolution)
      fd.append('aspect_ratio', aspectRatio)
      fd.append('duration', String(duration))
      if (firstImage) fd.append('first_image', firstImage)
      if (lastImage) fd.append('last_image', lastImage)
      if (clearFirst) fd.append('clear_first_image', 'true')
      if (clearLast) fd.append('clear_last_image', 'true')
      if (regenerate) fd.append('regenerate', 'true')

      const res = await fetch(`/api/veo/scenes/${scene.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    },
    onSuccess: (_, vars) => {
      toast.success(vars.regenerate ? 'Tersimpan & generate ulang dimulai' : 'Scene diperbarui')
      qc.invalidateQueries({ queryKey: ['veo-project', String(projectId)] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!scene) return null

  const hasExistingFirst = !!scene.firstImagePath && !clearFirst && !firstPreview
  const hasExistingLast = !!scene.lastImagePath && !clearLast && !lastPreview

  const generateImageMutation = useMutation({
    mutationFn: async ({ slot }: { slot: 'first' | 'last' }) => {
      const res = await fetch(`/api/veo/scenes/${scene.id}/generate-image`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slot,
          prompt: imagePrompt || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success(`Image (${data.slot}) berhasil di-generate`)
      qc.invalidateQueries({ queryKey: ['veo-project', String(projectId)] })
      // Clear pending file uploads to use the newly generated one
      if (data.slot === 'first') {
        setFirstImage(null)
        setFirstPreview(null)
        setClearFirst(false)
      } else {
        setLastImage(null)
        setLastPreview(null)
        setClearLast(false)
      }
    },
    onError: (e: Error) => toast.error(`Generate image gagal: ${e.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Scene #{scene.sceneNumber}</DialogTitle>
          <DialogDescription>
            Ubah prompt, model, atau image references. Klik "Save & Regenerate" untuk ulangi generate dengan setting baru.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { e.preventDefault() }} className="space-y-4">
          {/* Video Prompt */}
          <div className="space-y-2">
            <Label>Video Prompt (untuk Veo)</Label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              required
            />
          </div>

          {/* Image Prompt */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-blue-400" />
              Image Prompt (untuk generate gambar referensi)
            </Label>
            <Textarea
              value={imagePrompt}
              onChange={e => setImagePrompt(e.target.value)}
              rows={3}
              placeholder="(opsional, untuk fitur Image Generation nanti)"
            />
          </div>

          {/* Settings */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={v => setModel(v as VeoModel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="veo-3.1">Veo 3.1</SelectItem>
                  <SelectItem value="veo-3.1-fast">Veo 3.1 Fast</SelectItem>
                  <SelectItem value="veo-3.1-lite">Veo 3.1 Lite</SelectItem>
                  <SelectItem value="veo-2">Veo 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Aspect Ratio</Label>
              <Select value={aspectRatio} onValueChange={v => setAspectRatio(v as VeoAspectRatio)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 (Widescreen)</SelectItem>
                  <SelectItem value="9:16">9:16 (Shorts)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Resolution</Label>
              <Select value={resolution} onValueChange={v => setResolution(v as VeoResolution)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
              <div className="grid grid-cols-3 gap-2">
                {[4, 6, 8].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={cn(
                      'h-10 rounded-md border text-sm font-medium transition-colors',
                      duration === d ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/30'
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Image references */}
          <div className="space-y-2">
            <Label>Reference Images (opsional)</Label>
            <div className="grid grid-cols-2 gap-3">
              <ImageSlot
                label="First Image"
                preview={firstPreview}
                existingHint={hasExistingFirst}
                onChange={(file) => { setFirstImage(file); previewFile(file, setFirstPreview); setClearFirst(false) }}
                onClear={() => { setFirstImage(null); setFirstPreview(null); setClearFirst(true) }}
                onGenerate={imagePrompt.trim() ? () => generateImageMutation.mutate({ slot: 'first' }) : undefined}
                generating={generateImageMutation.isPending && generateImageMutation.variables?.slot === 'first'}
              />
              <ImageSlot
                label="Last Image"
                preview={lastPreview}
                existingHint={hasExistingLast}
                onChange={(file) => { setLastImage(file); previewFile(file, setLastPreview); setClearLast(false) }}
                onClear={() => { setLastImage(null); setLastPreview(null); setClearLast(true) }}
                onGenerate={imagePrompt.trim() ? () => generateImageMutation.mutate({ slot: 'last' }) : undefined}
                generating={generateImageMutation.isPending && generateImageMutation.variables?.slot === 'last'}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              <Wand2 className="inline h-3 w-3 mr-1 text-primary" />
              Klik "Generate" untuk bikin gambar AI dari image prompt di atas. Atau upload manual.
            </p>
          </div>
        </form>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => mutation.mutate({ regenerate: false })}
            disabled={mutation.isPending}
          >
            <Save className="h-4 w-4" />
            Save (tanpa regenerate)
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate({ regenerate: true })}
            disabled={mutation.isPending}
          >
            <RotateCw className="h-4 w-4" />
            Save & Regenerate Video
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImageSlot({ label, preview, existingHint, onChange, onClear, onGenerate, generating }: {
  label: string
  preview: string | null
  existingHint: boolean
  onChange: (file: File | null) => void
  onClear: () => void
  onGenerate?: () => void
  generating?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      {preview ? (
        <div className="relative rounded-lg border overflow-hidden aspect-video bg-muted">
          <img src={preview} alt="" className="w-full h-full object-cover" />
          <Button type="button" size="icon" variant="secondary" className="absolute top-1 right-1 h-6 w-6" onClick={onClear}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : existingHint ? (
        <div className="relative flex flex-col items-center justify-center gap-2 aspect-video border-2 border-emerald-500/30 bg-emerald-500/5 rounded-lg">
          <ImageIcon className="h-5 w-5 text-emerald-400" />
          <span className="text-xs text-emerald-300">Sudah ada</span>
          <Button type="button" size="icon" variant="secondary" className="absolute top-1 right-1 h-6 w-6" onClick={onClear} title="Hapus image">
            <X className="h-3 w-3" />
          </Button>
          <label className="absolute inset-0 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onChange(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      ) : generating ? (
        <div className="flex flex-col items-center justify-center gap-2 aspect-video border-2 border-primary/30 bg-primary/5 rounded-lg">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <span className="text-xs text-muted-foreground">Generating image...</span>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-2 aspect-video border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Upload manual</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        </label>
      )}

      {onGenerate && !generating && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={onGenerate}
        >
          <Wand2 className="h-3 w-3" />
          {preview || existingHint ? 'Regenerate Image' : 'Generate Image AI'}
        </Button>
      )}
    </div>
  )
}
