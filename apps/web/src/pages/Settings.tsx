import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, Youtube, User as UserIcon, Plus, Trash2, Globe2, BadgeCheck, KeyRound, Eye, EyeOff, Film, Wand2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth'
import { api } from '@/lib/api'
import { startYouTubeConnect } from '@/lib/youtube-connect'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { YoutubeAccount } from '@/lib/types'

export function SettingsPage() {
  const { user, logout, refresh } = useAuth()
  const qc = useQueryClient()

  const { data: accountsData } = useQuery({
    queryKey: ['youtube-accounts'],
    queryFn: () => api.get<{ accounts: YoutubeAccount[] }>('/api/youtube-accounts'),
  })
  const accounts = accountsData?.accounts ?? []

  const { data: workerHealth } = useQuery({
    queryKey: ['worker-health-settings'],
    queryFn: () => api.get<{ worker: 'online' | 'offline' }>('/api/system/worker-health'),
    refetchInterval: 15000,
  })

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/youtube-accounts/${id}`),
    onSuccess: () => {
      toast.success('Channel YouTube dihapus')
      qc.invalidateQueries({ queryKey: ['youtube-accounts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Akun aplikasi & channel YouTube</p>
      </div>

      {/* Akun App */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserIcon className="h-4 w-4" />
            Akun Aplikasi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1">
              <div className="font-semibold flex items-center gap-2">
                {user?.name}
                {user?.role === 'admin' && (
                  <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">Admin</span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">{user?.email}</div>
            </div>
            <Button variant="outline" onClick={logout}>Logout</Button>
          </div>
        </CardContent>
      </Card>

      {/* YouTube Channels */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Youtube className="h-4 w-4 text-primary" />
                Channel YouTube ({accounts.length})
              </CardTitle>
              <CardDescription>Channel yang bisa dipakai untuk upload</CardDescription>
            </div>
            <Button size="sm" onClick={() => startYouTubeConnect('/settings')}>
              <Plus className="h-4 w-4" />
              Tambah Channel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-10">
              <Youtube className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-4">Belum ada channel terhubung</p>
              <Button onClick={() => startYouTubeConnect('/settings')}>
                <Plus className="h-4 w-4" />
                Hubungkan Channel YouTube
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/30 transition-colors">
                  {acc.avatarUrl ? (
                    <img src={acc.avatarUrl} className="h-10 w-10 rounded-full" alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                      <Youtube className="h-5 w-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium flex items-center gap-2 truncate">
                      {acc.channelTitle || acc.name || acc.email}
                      <BadgeCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{acc.email}</div>
                  </div>
                  <div className="text-xs text-muted-foreground hidden sm:block">
                    Ditambah {formatRelativeTime(acc.createdAt)}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Hapus channel "${acc.channelTitle || acc.email}"?`)) {
                        removeMutation.mutate(acc.id)
                      }
                    }}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* GeminiGen.AI API Key */}
      <GeminigenKeyCard onSave={refresh} />

      {/* Gemini API Key */}
      <GeminiKeyCard onSave={refresh} />

      {/* Worker Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            Worker VPS US
          </CardTitle>
          <CardDescription>Server upload Amerika</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={cn(
            'flex items-center gap-3 rounded-lg border p-4',
            workerHealth?.worker === 'online'
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-amber-500/10 border-amber-500/30'
          )}>
            <div className={cn(
              'h-2 w-2 rounded-full',
              workerHealth?.worker === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
            )} />
            <div className="flex-1">
              <div className={cn('text-sm font-medium', workerHealth?.worker === 'online' ? 'text-emerald-300' : 'text-amber-300')}>
                {workerHealth?.worker === 'online' ? 'Worker Online' : 'Worker Offline / Belum Diset'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {workerHealth?.worker === 'online'
                  ? 'Upload akan dirutekan via VPS US'
                  : 'Set WORKER_URL & deploy worker ke VPS US'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe2 className="h-4 w-4" />
            Sistem
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Stack</span>
            <span className="font-mono">Bun + Elysia + React + Postgres</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Architecture</span>
            <span className="font-mono">Web (Indo) + Worker (US)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function GeminiKeyCard({ onSave }: { onSave: () => void }) {
  const { user } = useAuth()
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)

  const mutation = useMutation({
    mutationFn: (k: string) => api.patch('/auth/me/settings', { geminiApiKey: k }),
    onSuccess: () => {
      toast.success('Gemini API key disimpan')
      setKey('')
      onSave()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const isConnected = user?.hasGeminiKey

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          Google Gemini (Video to Prompt)
        </CardTitle>
        <CardDescription>API key dari Google AI Studio untuk fitur Video to Prompt</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={cn(
          'flex items-center gap-3 rounded-lg border p-4',
          isConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
        )}>
          <div className={cn('h-2 w-2 rounded-full', isConnected ? 'bg-emerald-400' : 'bg-amber-400')} />
          <div className="flex-1">
            <div className={cn('text-sm font-medium', isConnected ? 'text-emerald-300' : 'text-amber-300')}>
              {isConnected ? 'API Key tersimpan' : 'Belum ada API Key'}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {isConnected ? 'AI Analyzer siap dipakai' : 'Gratis di aistudio.google.com/app/apikey'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />
            {isConnected ? 'Ganti API Key' : 'API Key'}
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={show ? 'text' : 'password'}
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder="Paste API key dari aistudio.google.com..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button onClick={() => mutation.mutate(key)} disabled={mutation.isPending || !key.trim()}>
              Simpan
            </Button>
            {isConnected && (
              <Button variant="outline" onClick={() => mutation.mutate('')} disabled={mutation.isPending} title="Hapus">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Gratis & instant di <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">aistudio.google.com/app/apikey</a>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function GeminigenKeyCard({ onSave }: { onSave: () => void }) {
  const { user } = useAuth()
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)

  const mutation = useMutation({
    mutationFn: (k: string) =>
      api.patch('/auth/me/settings', { geminigenApiKey: k }),
    onSuccess: () => {
      toast.success('GeminiGen API key disimpan')
      setKey('')
      onSave()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const isConnected = user?.hasGeminigenKey

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Film className="h-4 w-4 text-primary" />
          GeminiGen.AI (Veo Studio)
        </CardTitle>
        <CardDescription>API key dari geminigen.ai untuk generate video AI</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={cn(
          'flex items-center gap-3 rounded-lg border p-4',
          isConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
        )}>
          <div className={cn('h-2 w-2 rounded-full', isConnected ? 'bg-emerald-400' : 'bg-amber-400')} />
          <div className="flex-1">
            <div className={cn('text-sm font-medium', isConnected ? 'text-emerald-300' : 'text-amber-300')}>
              {isConnected ? 'API Key tersimpan' : 'Belum ada API Key'}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {isConnected ? 'Veo Studio siap dipakai' : 'Set API key untuk pakai Veo Studio'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />
            {isConnected ? 'Ganti API Key' : 'API Key'}
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={show ? 'text' : 'password'}
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder="Paste API key dari geminigen.ai..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              onClick={() => mutation.mutate(key)}
              disabled={mutation.isPending || !key.trim()}
            >
              Simpan
            </Button>
            {isConnected && (
              <Button
                variant="outline"
                onClick={() => mutation.mutate('')}
                disabled={mutation.isPending}
                title="Hapus API key"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Dapatkan API key di <a href="https://geminigen.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">geminigen.ai</a>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
