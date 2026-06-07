import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  Camera, Hand, Smartphone, ArrowRight, ArrowLeft, Loader2,
  Image as ImageIcon, X, Link2, Upload as UploadIcon, Sparkles,
  Globe2, Square as SquareIcon, RectangleVertical, KeyRound,
  CheckCircle2, RefreshCw, Wand2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { getToken } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth'
import type { TiktokMode, TiktokContentType, TiktokProductInfo } from '@/lib/types'

const MODES: { value: TiktokMode; label: string; desc: string; icon: typeof Camera; color: string }[] = [
  { value: 'ugc',          label: 'UGC',              desc: 'Authentic testimonial style — person on camera',  icon: Camera,     color: 'text-violet-400' },
  { value: 'pov_hand',     label: 'POV Hand Review',  desc: 'First-person hands holding/using product',         icon: Hand,       color: 'text-amber-400' },
  { value: 'mirror_check', label: 'Mirror Check',     desc: 'Aesthetic mirror selfie style',                    icon: Smartphone, color: 'text-cyan-400' },
]

const CONTENT_TYPES: { value: TiktokContentType; label: string; desc: string; color: string }[] = [
  { value: 'review',    label: 'Review',    desc: 'Honest, subtle. Tidak menjual.',          color: 'text-blue-400' },
  { value: 'unboxing',  label: 'Unboxing',  desc: 'Excited discovery. Tidak menjual.',       color: 'text-emerald-400' },
  { value: 'affiliate', label: 'Affiliate', desc: 'Push selling — clear CTA.',               color: 'text-rose-400' },
]

const ASPECT_RATIOS = [
  { value: '9:16' as const,  label: '9:16 Portrait',  desc: 'TikTok / Reels / Shorts', icon: RectangleVertical },
  { value: '1:1' as const,   label: '1:1 Square',     desc: 'Instagram feed',          icon: SquareIcon },
  { value: '16:9' as const,  label: '16:9 Landscape', desc: 'YouTube reguler',          icon: RectangleVertical },
]

interface WizardState {
  step: 1 | 2 | 3
  // Step 1
  mode: TiktokMode | null
  // Step 2
  title: string
  productInput: 'url' | 'image' | null
  productUrl: string
  productImage: File | null
  productImagePreview: string | null
  productImagePath: string | null  // after analyze, server returns path
  baseModelImage: File | null      // optional, for UGC mode
  baseModelPreview: string | null
  product: TiktokProductInfo | null
  // Step 3
  environment: string
  environmentSuggestions: string[]
  language: 'id' | 'en'
  contentType: TiktokContentType
  aspectRatio: '9:16' | '16:9' | '1:1'
  resolution: '720p' | '1080p'
  veoModel: string
  sceneCount: number
}

export function TiktokNewPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [s, setS] = useState<WizardState>({
    step: 1,
    mode: null,
    title: '',
    productInput: null,
    productUrl: '',
    productImage: null,
    productImagePreview: null,
    productImagePath: null,
    baseModelImage: null,
    baseModelPreview: null,
    product: null,
    environment: '',
    environmentSuggestions: [],
    language: 'id',
    contentType: 'review',
    aspectRatio: '9:16',
    resolution: '1080p',
    veoModel: 'veo-2',
    sceneCount: 4,
  })

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setS(prev => ({ ...prev, [key]: value }))
  }

  // ===== Step 2: Scrape URL =====
  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch('/api/tiktok/scrape-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data as { product: TiktokProductInfo; image_url: string | null }
    },
    onSuccess: (data) => {
      update('product', data.product)
      toast.success('Info produk berhasil diambil')
    },
    onError: (e: Error) => toast.error(`Scrape gagal: ${e.message}`),
  })

  // ===== Step 2: Analyze Image =====
  const analyzeImageMutation = useMutation({
    mutationFn: async (image: File) => {
      const fd = new FormData()
      fd.append('image', image)
      const res = await fetch('/api/tiktok/analyze-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data as { product: TiktokProductInfo; image_path: string }
    },
    onSuccess: (data) => {
      update('product', data.product)
      update('productImagePath', data.image_path)
      toast.success('Produk teridentifikasi')
    },
    onError: (e: Error) => toast.error(`Analisa gambar gagal: ${e.message}`),
  })

  // ===== Step 3: Suggest environments =====
  const suggestEnvMutation = useMutation({
    mutationFn: async () => {
      if (!s.product) throw new Error('No product')
      const res = await fetch('/api/tiktok/suggest-environments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ product: s.product, language: s.language }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data.environments as string[]
    },
    onSuccess: (envs) => {
      update('environmentSuggestions', envs)
      if (!s.environment && envs[0]) update('environment', envs[0])
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ===== Step 3: Generate (Create Campaign) =====
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!s.product || !s.mode) throw new Error('Missing data')

      const fd = new FormData()
      fd.append('title', s.title)
      fd.append('mode', s.mode)
      fd.append('content_type', s.contentType)
      fd.append('language', s.language)
      fd.append('product_name', s.product.name)
      fd.append('product_description', s.product.description)
      fd.append('product_category', s.product.category || '')
      fd.append('product_brand', s.product.brand || '')
      fd.append('product_features', (s.product.key_features || []).join('|'))
      if (s.productUrl) fd.append('product_url', s.productUrl)
      if (s.productImage) fd.append('product_image', s.productImage)
      else if (s.productImagePath) fd.append('product_image_path', s.productImagePath)
      if (s.baseModelImage) fd.append('base_model_image', s.baseModelImage)
      fd.append('environment', s.environment)
      fd.append('aspect_ratio', s.aspectRatio)
      fd.append('resolution', s.resolution)
      fd.append('veo_model', s.veoModel)
      fd.append('scene_count', String(s.sceneCount))

      const res = await fetch('/api/tiktok/campaigns', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    },
    onSuccess: (data) => {
      toast.success('Campaign dibuat, generate dimulai!')
      navigate(`/tiktok/${data.campaign.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleImageFile(file: File | null, kind: 'product' | 'base') {
    if (!file) return
    if (kind === 'product') {
      update('productImage', file)
      const reader = new FileReader()
      reader.onload = (e) => update('productImagePreview', e.target?.result as string)
      reader.readAsDataURL(file)
      // Auto-trigger Claude vision analyze
      analyzeImageMutation.mutate(file)
    } else {
      update('baseModelImage', file)
      const reader = new FileReader()
      reader.onload = (e) => update('baseModelPreview', e.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  function next() { update('step', Math.min(3, s.step + 1) as WizardState['step']) }
  function back() { update('step', Math.max(1, s.step - 1) as WizardState['step']) }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/tiktok">
            <ArrowLeft className="h-4 w-4" />
            Kembali ke TikTok Studio
          </Link>
        </Button>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Buat TikTok Campaign
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          3 langkah: Pilih mode → Upload produk → Setting studio
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((stepNum) => (
          <div key={stepNum} className="flex items-center gap-2 flex-1">
            <div className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold',
              s.step >= stepNum ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}>
              {s.step > stepNum ? <CheckCircle2 className="h-4 w-4" /> : stepNum}
            </div>
            {stepNum < 3 && (
              <div className={cn('flex-1 h-0.5', s.step > stepNum ? 'bg-primary' : 'bg-muted')} />
            )}
          </div>
        ))}
      </div>

      {/* API key check */}
      {!user?.hasAnthropicKey && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <KeyRound className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-amber-300">Anthropic API key belum di-set</p>
              <p className="text-xs text-muted-foreground mt-1">Set di Settings dulu untuk pakai TikTok Studio.</p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">Settings</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ============ STEP 1: Mode ============ */}
      {s.step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Pilih Mode Video</CardTitle>
            <CardDescription>Style visual yang paling cocok dengan campaign kamu</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              {MODES.map(({ value, label, desc, icon: Icon, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => update('mode', value)}
                  className={cn(
                    'flex flex-col items-center gap-3 rounded-xl border-2 p-5 transition-all text-left',
                    s.mode === value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40 hover:bg-accent/30'
                  )}
                >
                  <Icon className={cn('h-10 w-10', color)} />
                  <div className="text-center">
                    <div className="font-semibold">{label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={next} disabled={!s.mode}>
                Lanjut <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============ STEP 2: Upload Inputs ============ */}
      {s.step === 2 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Judul Campaign</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                value={s.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Misal: Promo Parfum Akhir Tahun"
                maxLength={200}
              />
            </CardContent>
          </Card>

          {/* Base Model (only for UGC mode) */}
          {s.mode === 'ugc' && (
            <Card>
              <CardHeader>
                <CardTitle>Foto Talent / Model (opsional)</CardTitle>
                <CardDescription>Foto orang yang akan jadi "talent" UGC. Bisa skip untuk text-only.</CardDescription>
              </CardHeader>
              <CardContent>
                {s.baseModelPreview ? (
                  <div className="relative inline-block">
                    <img src={s.baseModelPreview} className="rounded-lg max-h-64 border" alt="" />
                    <Button
                      type="button" size="icon" variant="secondary"
                      className="absolute top-2 right-2 h-7 w-7"
                      onClick={() => { update('baseModelImage', null); update('baseModelPreview', null) }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <label className="flex items-center gap-3 border-2 border-dashed rounded-lg p-6 cursor-pointer hover:border-primary/50 transition-colors">
                    <Camera className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Pilih foto talent (orang)...</span>
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => handleImageFile(e.target.files?.[0] ?? null, 'base')}
                    />
                  </label>
                )}
              </CardContent>
            </Card>
          )}

          {/* Product Input */}
          <Card>
            <CardHeader>
              <CardTitle>Produk</CardTitle>
              <CardDescription>Paste link TikTok Shop, atau upload gambar produk</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!s.productInput && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => update('productInput', 'url')}
                    className="flex flex-col items-center gap-2 rounded-lg border-2 p-5 hover:border-primary/40 hover:bg-accent/30 transition-all"
                  >
                    <Link2 className="h-8 w-8 text-blue-400" />
                    <div className="font-medium text-sm">Paste URL</div>
                    <div className="text-xs text-muted-foreground text-center">TikTok Shop / Shopee / Tokopedia link</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => update('productInput', 'image')}
                    className="flex flex-col items-center gap-2 rounded-lg border-2 p-5 hover:border-primary/40 hover:bg-accent/30 transition-all"
                  >
                    <ImageIcon className="h-8 w-8 text-emerald-400" />
                    <div className="font-medium text-sm">Upload Gambar</div>
                    <div className="text-xs text-muted-foreground text-center">AI identify produk dari foto</div>
                  </button>
                </div>
              )}

              {/* URL input */}
              {s.productInput === 'url' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={s.productUrl}
                      onChange={(e) => update('productUrl', e.target.value)}
                      placeholder="https://www.tiktok.com/.../product/..."
                    />
                    <Button
                      type="button"
                      onClick={() => scrapeMutation.mutate(s.productUrl)}
                      disabled={!s.productUrl || scrapeMutation.isPending}
                    >
                      {scrapeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ambil'}
                    </Button>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => update('productInput', null)}>
                    Ganti ke upload gambar
                  </Button>
                </div>
              )}

              {/* Image input */}
              {s.productInput === 'image' && (
                <div className="space-y-3">
                  {s.productImagePreview ? (
                    <div className="relative inline-block">
                      <img src={s.productImagePreview} className="rounded-lg max-h-64 border" alt="" />
                      <Button
                        type="button" size="icon" variant="secondary"
                        className="absolute top-2 right-2 h-7 w-7"
                        onClick={() => {
                          update('productImage', null)
                          update('productImagePreview', null)
                          update('productImagePath', null)
                          update('product', null)
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                      {analyzeImageMutation.isPending && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
                          <div className="text-white text-sm flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            AI menganalisa...
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <label className="flex items-center gap-3 border-2 border-dashed rounded-lg p-6 cursor-pointer hover:border-primary/50 transition-colors">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Pilih foto produk...</span>
                      <input
                        type="file" accept="image/*" className="hidden"
                        onChange={(e) => handleImageFile(e.target.files?.[0] ?? null, 'product')}
                      />
                    </label>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => update('productInput', null)}>
                    Ganti ke paste URL
                  </Button>
                </div>
              )}

              {/* Product confirmation */}
              {s.product && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <span className="font-medium text-emerald-300">Produk teridentifikasi</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Nama</Label>
                      <Input
                        value={s.product.name}
                        onChange={(e) => update('product', { ...s.product!, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Deskripsi</Label>
                      <Textarea
                        value={s.product.description}
                        onChange={(e) => update('product', { ...s.product!, description: e.target.value })}
                        rows={2}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Kategori</Label>
                        <Input
                          value={s.product.category}
                          onChange={(e) => update('product', { ...s.product!, category: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Brand</Label>
                        <Input
                          value={s.product.brand}
                          onChange={(e) => update('product', { ...s.product!, brand: e.target.value })}
                        />
                      </div>
                    </div>
                    {s.product.key_features.length > 0 && (
                      <div>
                        <Label className="text-xs">Fitur Utama</Label>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {s.product.key_features.map((f, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{f}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={back}>
              <ArrowLeft className="h-4 w-4" /> Kembali
            </Button>
            <Button onClick={next} disabled={!s.title || !s.product}>
              Lanjut <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* ============ STEP 3: Studio Settings ============ */}
      {s.step === 3 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Studio Settings</CardTitle>
              <CardDescription>Konfigurasi visual & content type</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Content Type */}
              <div>
                <Label className="mb-2 block">Content Type</Label>
                <div className="grid sm:grid-cols-3 gap-2">
                  {CONTENT_TYPES.map(({ value, label, desc, color }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => update('contentType', value)}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg border p-3 text-left transition-all',
                        s.contentType === value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                      )}
                    >
                      <span className={cn('font-semibold text-sm', color)}>{label}</span>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div>
                <Label className="mb-2 block">Bahasa Script</Label>
                <Select value={s.language} onValueChange={(v) => update('language', v as 'id' | 'en')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="id">Bahasa Indonesia</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Environment */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Environment / Backdrop</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => suggestEnvMutation.mutate()}
                    disabled={suggestEnvMutation.isPending}
                  >
                    {suggestEnvMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Suggest by AI
                  </Button>
                </div>
                <Textarea
                  value={s.environment}
                  onChange={(e) => update('environment', e.target.value)}
                  rows={2}
                  placeholder="Misal: Meja kayu jati solid dengan pencahayaan warm ambient"
                />
                {s.environmentSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.environmentSuggestions.map((env, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => update('environment', env)}
                        className={cn(
                          'text-xs px-3 py-1.5 rounded-full border transition-colors',
                          s.environment === env
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/30'
                        )}
                      >
                        {env}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Aspect Ratio */}
              <div>
                <Label className="mb-2 block">Aspect Ratio</Label>
                <div className="grid grid-cols-3 gap-2">
                  {ASPECT_RATIOS.map(({ value, label, desc, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => update('aspectRatio', value)}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg border p-3',
                        s.aspectRatio === value ? 'border-primary bg-primary/5' : 'border-border'
                      )}
                    >
                      <Icon className={cn('h-5 w-5', value === '16:9' && 'rotate-90')} />
                      <div className="font-medium text-xs">{label}</div>
                      <div className="text-[10px] text-muted-foreground">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Resolution + Scene Count + Veo Model */}
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label className="mb-2 block">Resolution</Label>
                  <Select value={s.resolution} onValueChange={(v) => update('resolution', v as '720p' | '1080p')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="720p">720p HD</SelectItem>
                      <SelectItem value="1080p">1080p Full HD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-2 block">Video Model</Label>
                  <Select value={s.veoModel} onValueChange={(v) => update('veoModel', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="veo-2">Veo 2 (flexible)</SelectItem>
                      <SelectItem value="veo-3.1">Veo 3.1</SelectItem>
                      <SelectItem value="veo-3.1-fast">Veo 3.1 Fast</SelectItem>
                      <SelectItem value="veo-3.1-lite">Veo 3.1 Lite (audio)</SelectItem>
                      <SelectItem value="grok-3">Grok 3 (xAI, 10s clips)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-2 block">Jumlah Scene</Label>
                  <Select value={String(s.sceneCount)} onValueChange={(v) => update('sceneCount', Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2 Scenes</SelectItem>
                      <SelectItem value="4">4 Scenes</SelectItem>
                      <SelectItem value="6">6 Scenes</SelectItem>
                      <SelectItem value="8">8 Scenes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex gap-2 text-xs">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <p className="text-muted-foreground">
                  Claude akan generate {s.sceneCount} scene script dalam {s.language === 'id' ? 'Bahasa Indonesia' : 'English'},
                  lalu Veo generate video per scene. Total ~{s.sceneCount * 2}-{s.sceneCount * 5} menit.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={back}>
              <ArrowLeft className="h-4 w-4" /> Kembali
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!s.environment || createMutation.isPending}
              size="lg"
              className="bg-pink-600 hover:bg-pink-700"
            >
              {createMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating script...</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Generate Campaign</>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
