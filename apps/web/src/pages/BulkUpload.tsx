import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Layers, FileVideo, X, Plus, Youtube, AlertTriangle, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { uploadWithProgress, api } from '@/lib/api'
import { startYouTubeConnect } from '@/lib/youtube-connect'
import { formatBytes } from '@/lib/utils'
import { toast } from 'sonner'
import type { Category, YoutubeAccount } from '@/lib/types'

const PRIVACY_OPTIONS = [
  { value: 'private', label: 'Private (recommended untuk bulk)' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'public', label: 'Public' },
]

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Indonesian' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' },
]

export function BulkUploadPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)

  const [form, setForm] = useState({
    youtube_account_id: '',
    description: '',
    tags: '',
    category_id: '22',
    privacy: 'private',
    language: 'en',
  })

  const { data: ytData } = useQuery({
    queryKey: ['youtube-accounts'],
    queryFn: () => api.get<{ accounts: YoutubeAccount[] }>('/api/youtube-accounts'),
  })
  const accounts = ytData?.accounts ?? []
  const hasAccounts = accounts.length > 0

  const { data: catData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ categories: Category[] }>('/api/meta/categories'),
  })
  const categories = catData?.categories ?? []

  useEffect(() => {
    if (hasAccounts && !form.youtube_account_id) {
      setForm(prev => ({ ...prev, youtube_account_id: String(accounts[0].id) }))
    }
  }, [hasAccounts, accounts, form.youtube_account_id])

  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return
    const arr = Array.from(newFiles).filter(f => f.type.startsWith('video/'))
    setFiles(prev => [...prev, ...arr])
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (files.length === 0) {
      toast.error('Pilih minimal 1 file video')
      return
    }
    if (!form.youtube_account_id) {
      toast.error('Pilih channel YouTube')
      return
    }

    setSubmitting(true)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('videos', f)
      fd.append('youtube_account_id', form.youtube_account_id)
      if (form.description) fd.append('description', form.description)
      if (form.tags) fd.append('tags', form.tags)
      fd.append('category_id', form.category_id)
      fd.append('privacy', form.privacy)
      fd.append('language', form.language)

      const result = await uploadWithProgress<{ ok: boolean; count: number }>(
        '/api/videos/bulk',
        fd,
        (pct) => setProgress(pct)
      )

      toast.success(`${result.count} video diunggah, sedang antri upload`)
      navigate('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk upload gagal')
      setSubmitting(false)
    }
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0)

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20 md:pb-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            Bulk Upload
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Upload banyak video sekaligus dengan metadata sama</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Channel selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Youtube className="h-4 w-4 text-primary" />
              Channel YouTube
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasAccounts ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-amber-500/30 bg-amber-500/5 p-6 text-center">
                <AlertTriangle className="h-8 w-8 text-amber-400" />
                <p className="font-medium">Belum ada channel terhubung</p>
                <Button type="button" onClick={() => startYouTubeConnect('/bulk-upload')}>
                  <Plus className="h-4 w-4" />
                  Hubungkan Channel
                </Button>
              </div>
            ) : (
              <Select value={form.youtube_account_id} onValueChange={v => update('youtube_account_id', v)}>
                <SelectTrigger><SelectValue placeholder="Pilih channel..." /></SelectTrigger>
                <SelectContent>
                  {accounts.map(acc => (
                    <SelectItem key={acc.id} value={String(acc.id)}>
                      {acc.channelTitle || acc.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {hasAccounts && (
          <>
            {/* File picker */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">File Video ({files.length})</CardTitle>
                <CardDescription>
                  {files.length === 0 ? 'Pilih banyak file video sekaligus' : `Total: ${formatBytes(totalSize)}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer hover:border-primary/50 transition-colors">
                  <Layers className="h-10 w-10 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-medium">Klik untuk pilih banyak video</p>
                    <p className="text-xs text-muted-foreground mt-1">Bisa Cmd+Click untuk multi-select</p>
                  </div>
                  <input
                    type="file"
                    accept="video/*,.mkv"
                    multiple
                    className="hidden"
                    onChange={(e) => addFiles(e.target.files)}
                  />
                </label>

                {files.length > 0 && (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {files.map((f, idx) => (
                      <div key={idx} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                        <FileVideo className="h-5 w-5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{f.name}</div>
                          <div className="text-xs text-muted-foreground">{formatBytes(f.size)}</div>
                        </div>
                        <Button type="button" size="icon" variant="ghost" onClick={() => removeFile(idx)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Shared metadata */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Metadata (untuk semua video)</CardTitle>
                <CardDescription>Judul otomatis dari nama file. Semua video akan dapat metadata yang sama.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Deskripsi</Label>
                  <Textarea
                    value={form.description}
                    onChange={e => update('description', e.target.value)}
                    placeholder="Deskripsi yang akan dipakai semua video..."
                    rows={4}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Tags</Label>
                  <Input
                    value={form.tags}
                    onChange={e => update('tags', e.target.value)}
                    placeholder="tag1, tag2, tag3"
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
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
                    <Label>Privasi</Label>
                    <Select value={form.privacy} onValueChange={v => update('privacy', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRIVACY_OPTIONS.map(p => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Bahasa</Label>
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

            {/* Tips */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1">
                    <p className="font-medium">Tips Bulk Upload</p>
                    <ul className="text-muted-foreground text-xs space-y-1 list-disc list-inside">
                      <li>Default privasi <strong className="text-foreground">Private</strong>, bisa edit per-video setelahnya</li>
                      <li>Judul otomatis dari nama file (tanpa ekstensi)</li>
                      <li>Upload sequential — 1 video selesai, lanjut yang berikutnya</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

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

            <div className="flex gap-3">
              <Button type="submit" disabled={submitting || files.length === 0} size="lg" className="flex-1">
                {submitting ? `Mengunggah ${progress}%...` : `Upload ${files.length} Video`}
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={() => navigate('/')}>Batal</Button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
