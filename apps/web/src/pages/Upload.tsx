import { useState, useRef, useEffect, type FormEvent } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Upload as UploadIcon, Image as ImageIcon, FileVideo, X, Sparkles, Globe2, Lock, Link2, Plus, Youtube, AlertTriangle, Send, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, uploadWithProgress } from '@/lib/api'
import { startYouTubeConnect } from '@/lib/youtube-connect'
import { formatBytes, cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Category, Video, YoutubeAccount } from '@/lib/types'

// Stored UTC ISO -> value a datetime-local input expects (local WIB wall-clock).
function utcToLocalInput(iso: string): string {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const PRIVACY_OPTIONS = [
  { value: 'public',   label: 'Public',   icon: Globe2, desc: 'Semua orang bisa lihat' },
  { value: 'unlisted', label: 'Unlisted', icon: Link2,  desc: 'Hanya yang punya link' },
  { value: 'private',  label: 'Private',  icon: Lock,   desc: 'Hanya kamu' },
]

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Indonesian' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
]

interface FormData {
  title: string
  description: string
  tags: string
  category_id: string
  privacy: 'public' | 'private' | 'unlisted'
  language: string
  made_for_kids: boolean
  scheduled_at: string
  youtube_account_id: string
}

export function UploadPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const isEdit = !!editId

  const formRef = useRef<HTMLFormElement>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [thumbFile, setThumbFile] = useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [isShort, setIsShort] = useState(false) // append #Shorts so YouTube treats it as a Short
  const [editVideo, setEditVideo] = useState<Video | null>(null)

  const pushMetadataMutation = useMutation({
    mutationFn: () => api.post(`/api/videos/${editId}/push-metadata`),
    onSuccess: () => {
      toast.success('Metadata berhasil di-push ke YouTube')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [form, setForm] = useState<FormData>({
    title: '',
    description: '',
    tags: '',
    category_id: '22',
    privacy: 'public',
    language: 'en',
    made_for_kids: false,
    scheduled_at: '',
    youtube_account_id: '',
  })

  const { data: catData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ categories: Category[] }>('/api/meta/categories'),
  })
  const categories = catData?.categories ?? []

  const { data: ytData } = useQuery({
    queryKey: ['youtube-accounts'],
    queryFn: () => api.get<{ accounts: YoutubeAccount[] }>('/api/youtube-accounts'),
  })
  const accounts = ytData?.accounts ?? []
  const hasAccounts = accounts.length > 0

  // Auto-select first YouTube account
  useEffect(() => {
    if (hasAccounts && !form.youtube_account_id) {
      setForm(prev => ({ ...prev, youtube_account_id: String(accounts[0].id) }))
    }
  }, [hasAccounts, accounts, form.youtube_account_id])

  // Load video for edit mode
  useEffect(() => {
    if (!editId) return
    api.get<{ video: Video }>(`/api/videos/${editId}`).then(({ video }) => {
      setEditVideo(video)
      setForm({
        title: video.title,
        description: video.description,
        tags: video.tags,
        category_id: video.categoryId,
        privacy: video.privacy,
        language: video.language,
        made_for_kids: video.madeForKids,
        scheduled_at: video.scheduledAt ? utcToLocalInput(video.scheduledAt) : '',
        youtube_account_id: video.youtubeAccountId ? String(video.youtubeAccountId) : '',
      })
    }).catch(() => toast.error('Gagal memuat video'))
  }, [editId])

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleVideoSelect(file: File | null) {
    setVideoFile(file)
    if (file && !form.title) {
      const name = file.name.replace(/\.[^.]+$/, '')
      update('title', name)
    }
  }

  function handleThumbSelect(file: File | null) {
    setThumbFile(file)
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => setThumbPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setThumbPreview(null)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!isEdit && !form.youtube_account_id) {
      toast.error('Pilih channel YouTube dulu')
      return
    }

    // Short mode: ensure the title carries #Shorts so YouTube classifies it as a Short.
    const effectiveTitle = isShort && !/#shorts/i.test(form.title)
      ? `${form.title} #Shorts`.slice(0, 100)
      : form.title

    setSubmitting(true)
    try {
      if (isEdit) {
        await api.patch(`/api/videos/${editId}`, {
          title: effectiveTitle,
          description: form.description,
          tags: form.tags,
          categoryId: form.category_id,
          privacy: form.privacy,
          language: form.language,
          madeForKids: form.made_for_kids,
        })
        toast.success('Metadata diperbarui')
        navigate('/')
      } else {
        if (!videoFile) {
          toast.error('Pilih file video dulu')
          setSubmitting(false)
          return
        }

        const fd = new FormData()
        fd.append('video', videoFile)
        if (thumbFile) fd.append('thumbnail', thumbFile)
        Object.entries(form).forEach(([key, value]) => {
          if (value === '' || value === false) return
          if (key === 'scheduled_at') {
            // datetime-local is naive local (WIB) time. Convert to a real UTC
            // instant so the server stores the exact moment picked — otherwise
            // the UTC server reads "06:00" as 06:00 UTC (= 13:00 WIB).
            fd.append(key, new Date(value as string).toISOString())
          } else {
            fd.append(key, String(value))
          }
        })
        fd.set('title', effectiveTitle)

        await uploadWithProgress('/api/videos', fd, (pct) => setProgress(pct))
        toast.success('Video diunggah ke server, upload ke YouTube dimulai')
        navigate('/')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload gagal')
      setSubmitting(false)
    }
  }

  const selectedAccount = accounts.find(a => String(a.id) === form.youtube_account_id)

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20 md:pb-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {isEdit ? 'Edit Metadata' : 'Upload Video Baru'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEdit ? 'Ubah informasi video' : 'Upload ke YouTube via VPS US untuk audiens Amerika'}
          </p>
        </div>
      )}

      {isEdit && editVideo?.youtubeUrl && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                <Youtube className="h-4 w-4 text-primary shrink-0" />
                Sudah di-upload ke YouTube
              </div>
              <a
                href={editVideo.youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
              >
                <ExternalLink className="h-3 w-3" />
                {editVideo.youtubeUrl}
              </a>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => pushMetadataMutation.mutate()}
              disabled={pushMetadataMutation.isPending}
            >
              <Send className="h-4 w-4" />
              {pushMetadataMutation.isPending ? 'Pushing...' : 'Push Metadata ke YouTube'}
            </Button>
          </CardContent>
        </Card>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
        {/* Channel selector — only for create mode */}
        {!isEdit && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Youtube className="h-4 w-4 text-primary" />
                Channel YouTube
              </CardTitle>
              <CardDescription>Pilih channel tujuan upload</CardDescription>
            </CardHeader>
            <CardContent>
              {!hasAccounts ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-amber-500/30 bg-amber-500/5 p-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-amber-400" />
                  <div>
                    <p className="font-medium">Belum ada channel YouTube terhubung</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Hubungkan minimal 1 channel untuk bisa upload
                    </p>
                  </div>
                  <Button type="button" onClick={() => startYouTubeConnect('/upload')}>
                    <Plus className="h-4 w-4" />
                    Hubungkan Channel YouTube
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Select
                    value={form.youtube_account_id}
                    onValueChange={v => update('youtube_account_id', v)}
                  >
                    <SelectTrigger className="h-auto py-2.5">
                      <SelectValue placeholder="Pilih channel..." />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map(acc => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{acc.channelTitle || acc.name || acc.email}</span>
                            <span className="text-xs text-muted-foreground">({acc.email})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedAccount && (
                    <div className="flex items-center gap-3 rounded-lg bg-muted/30 p-3">
                      {selectedAccount.avatarUrl ? (
                        <img src={selectedAccount.avatarUrl} className="h-10 w-10 rounded-full" alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                          <Youtube className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{selectedAccount.channelTitle || selectedAccount.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{selectedAccount.email}</div>
                      </div>
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => startYouTubeConnect('/upload')}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4" />
                    Tambah Channel Lain
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Video uploader */}
        {!isEdit && hasAccounts && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">File Video</CardTitle>
              <CardDescription>MP4, MOV, AVI, MKV. Maks 2GB.</CardDescription>
            </CardHeader>
            <CardContent>
              {videoFile ? (
                <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileVideo className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{videoFile.name}</div>
                    <div className="text-xs text-muted-foreground">{formatBytes(videoFile.size)}</div>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => handleVideoSelect(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer hover:border-primary/50 transition-colors">
                  <UploadIcon className="h-10 w-10 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-medium">Klik atau drag file video</p>
                    <p className="text-xs text-muted-foreground mt-1">MP4 / MOV / AVI / MKV</p>
                  </div>
                  <input
                    type="file"
                    accept="video/*,.mkv"
                    className="hidden"
                    onChange={(e) => handleVideoSelect(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </CardContent>
          </Card>
        )}

        {/* Show rest of form only if has accounts (or in edit mode) */}
        {(hasAccounts || isEdit) && (
          <>
            {/* Metadata */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Detail Video</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="title">
                    Judul <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="title"
                    value={form.title}
                    onChange={e => update('title', e.target.value)}
                    placeholder="Judul video YouTube..."
                    maxLength={100}
                    required
                  />
                  <div className="text-xs text-muted-foreground text-right">{form.title.length}/100</div>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="isShort">Upload sebagai Short</Label>
                    <p className="text-xs text-muted-foreground">Video vertikal &lt;3 menit. Otomatis tambah <b>#Shorts</b> di judul.</p>
                  </div>
                  <Switch id="isShort" checked={isShort} onCheckedChange={setIsShort} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Deskripsi</Label>
                  <Textarea
                    id="description"
                    value={form.description}
                    onChange={e => update('description', e.target.value)}
                    placeholder="Tulis deskripsi video..."
                    maxLength={5000}
                    rows={6}
                  />
                  <div className="text-xs text-muted-foreground text-right">{form.description.length}/5000</div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tags">Tags</Label>
                  <Input
                    id="tags"
                    value={form.tags}
                    onChange={e => update('tags', e.target.value)}
                    placeholder="tutorial, how to, english (pisah dengan koma)"
                  />
                  <p className="text-xs text-muted-foreground">Gunakan tags bahasa Inggris untuk targeting US</p>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Kategori</Label>
                    <Select value={form.category_id} onValueChange={v => update('category_id', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {categories.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Bahasa Video</Label>
                    <Select value={form.language} onValueChange={v => update('language', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map(l => (
                          <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Privacy & Schedule */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Privasi & Penjadwalan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <Label className="mb-3 block">Visibility</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {PRIVACY_OPTIONS.map(({ value, label, icon: Icon, desc }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => update('privacy', value as FormData['privacy'])}
                        className={cn(
                          'flex flex-col items-center gap-2 rounded-lg border p-4 transition-all text-left',
                          form.privacy === value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/30 hover:bg-accent/30'
                        )}
                      >
                        <Icon className={cn('h-5 w-5', form.privacy === value ? 'text-primary' : 'text-muted-foreground')} />
                        <div className="font-medium text-sm">{label}</div>
                        <div className="text-xs text-muted-foreground text-center">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scheduled_at">Jadwal Publish (opsional)</Label>
                  <Input
                    id="scheduled_at"
                    type="datetime-local"
                    value={form.scheduled_at}
                    onChange={e => update('scheduled_at', e.target.value)}
                    disabled={isEdit}
                  />
                  <p className="text-xs text-muted-foreground">Kosongkan untuk upload langsung</p>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Label htmlFor="kids" className="cursor-pointer">Made for Kids</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Konten ditujukan untuk anak-anak</p>
                  </div>
                  <Switch
                    id="kids"
                    checked={form.made_for_kids}
                    onCheckedChange={v => update('made_for_kids', v)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Thumbnail */}
            {!isEdit && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Thumbnail (opsional)</CardTitle>
                  <CardDescription>JPG / PNG / WebP, maks 2MB.</CardDescription>
                </CardHeader>
                <CardContent>
                  {thumbPreview ? (
                    <div className="relative inline-block">
                      <img src={thumbPreview} className="rounded-lg max-h-48 border" alt="" />
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="absolute top-2 right-2 h-7 w-7"
                        onClick={() => handleThumbSelect(null)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-3 border rounded-lg p-3 cursor-pointer hover:border-primary/50 transition-colors">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Pilih thumbnail...</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => handleThumbSelect(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tips */}
            {!isEdit && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div className="text-sm space-y-1">
                      <p className="font-medium">Tips untuk audiens US</p>
                      <ul className="text-muted-foreground text-xs space-y-1 list-disc list-inside">
                        <li>Set bahasa <strong className="text-foreground">English</strong> agar YouTube merekomendasikan ke US</li>
                        <li>Tags dalam bahasa Inggris meningkatkan discoverability</li>
                        <li>Upload akan diteruskan ke VPS US sehingga YouTube melihat IP Amerika</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Progress */}
            {submitting && progress > 0 && progress < 100 && (
              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Upload ke server...</span>
                    <span className="text-primary font-medium">{progress}%</span>
                  </div>
                  <Progress value={progress} />
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button type="submit" disabled={submitting} size="lg" className="flex-1">
                {submitting ? (isEdit ? 'Menyimpan...' : `Mengunggah ${progress}%...`) : (isEdit ? 'Simpan Perubahan' : 'Upload Video')}
              </Button>
              <Button type="button" variant="outline" size="lg" asChild>
                <Link to="/">Batal</Link>
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
