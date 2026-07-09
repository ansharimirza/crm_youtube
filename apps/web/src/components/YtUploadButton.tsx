import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Youtube, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import type { YoutubeAccount } from '@/lib/types'

// Compact inline "Upload to YouTube" control for a single Short/clip. Posts JSON to
// `uploadPath` ({ youtubeAccountId, title, privacy }). Upload runs via the US worker.
export function YtUploadButton({ uploadPath, defaultTitle }: { uploadPath: string; defaultTitle: string }) {
  const [open, setOpen] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [title, setTitle] = useState(defaultTitle)
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>('public')

  const { data } = useQuery({
    queryKey: ['youtube-accounts'],
    queryFn: () => api.get<{ accounts: YoutubeAccount[] }>('/api/youtube-accounts'),
    enabled: open,
  })
  const accounts = data?.accounts ?? []

  const up = useMutation({
    mutationFn: () => api.post(uploadPath, { youtubeAccountId: Number(accountId), title: title.trim(), privacy }),
    onSuccess: () => { toast.success('Masuk antrian upload (via server US) — pantau di menu Upload'); setOpen(false) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Youtube className="h-3.5 w-3.5 text-red-500" /> Upload YouTube
      </Button>
    )
  }
  return (
    <div className="space-y-1.5 rounded border p-2">
      <Select value={accountId} onValueChange={setAccountId}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih channel" /></SelectTrigger>
        <SelectContent>
          {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.channelTitle || a.email}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul" className="h-8 text-xs" maxLength={90} />
      <Select value={privacy} onValueChange={(v) => setPrivacy(v as 'public' | 'unlisted' | 'private')}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="public">Public</SelectItem>
          <SelectItem value="unlisted">Unlisted</SelectItem>
          <SelectItem value="private">Private</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex gap-1.5">
        <Button size="sm" className="flex-1 h-8 text-xs" disabled={!accountId || !title.trim() || up.isPending} onClick={() => up.mutate()}>
          {up.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Youtube className="h-3.5 w-3.5" />} Upload
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setOpen(false)}>Batal</Button>
      </div>
    </div>
  )
}
