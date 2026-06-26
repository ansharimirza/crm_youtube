import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileAudio, Loader2, Copy, Download, Check, Clock, AlignLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface Segment { start: number; end: number; text: string }

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}

export function TranscribePage() {
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [srt, setSrt] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [view, setView] = useState<'timestamp' | 'plain'>('timestamp')
  const [copied, setCopied] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('audio', file!)
      return api.post<{ text: string; srt: string; segments: Segment[] }>('/api/tools/transcribe', fd)
    },
    onSuccess: (r) => {
      setText(r.text)
      setSrt(r.srt)
      setSegments(r.segments ?? [])
      toast.success('Transkrip selesai')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const timestamped = segments.map((s) => `${fmt(s.start)}  ${s.text}`).join('\n')

  function download(content: string, name: string) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }
  function copy(content: string, which: string) {
    navigator.clipboard.writeText(content)
    setCopied(which)
    setTimeout(() => setCopied(''), 1500)
  }
  const baseName = file?.name.replace(/\.[^.]+$/, '') || 'transcript'

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <FileAudio className="h-6 w-6 text-primary" /> Transcribe
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload audio → transkrip dengan timestamp + SRT (caption YouTube). Gratis (Groq Whisper).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Audio</CardTitle>
          <CardDescription>MP3, WAV, M4A, dll. Bahasa apa aja (auto-detect).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
            {file && <span className="text-xs text-emerald-400 truncate">🔊 {file.name}</span>}
          </div>
          <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Mentranskrip...</> : <><FileAudio className="h-4 w-4" /> Transcribe</>}
          </Button>
        </CardContent>
      </Card>

      {(segments.length > 0 || text) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
            <div className="flex items-center gap-1 rounded-lg border p-0.5">
              <button onClick={() => setView('timestamp')}
                className={cn('text-xs px-2.5 py-1 rounded inline-flex items-center gap-1', view === 'timestamp' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                <Clock className="h-3.5 w-3.5" /> Timestamp
              </button>
              <button onClick={() => setView('plain')}
                className={cn('text-xs px-2.5 py-1 rounded inline-flex items-center gap-1', view === 'plain' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                <AlignLeft className="h-3.5 w-3.5" /> Teks polos
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => copy(view === 'timestamp' ? timestamped : text, view)}>
                {copied === view ? <><Check className="h-3.5 w-3.5" /> Tersalin</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </Button>
              <Button size="sm" variant="outline" onClick={() => download(text, `${baseName}.txt`)}><Download className="h-3.5 w-3.5" /> .txt</Button>
              {srt && <Button size="sm" variant="outline" onClick={() => download(srt, `${baseName}.srt`)}><Download className="h-3.5 w-3.5" /> .srt</Button>}
            </div>
          </CardHeader>
          <CardContent>
            {view === 'timestamp' ? (
              <div className="max-h-[60vh] overflow-y-auto rounded-lg border divide-y divide-border/50">
                {segments.map((s, i) => (
                  <div key={i} className="flex gap-3 px-3 py-2 hover:bg-muted/30">
                    <span className="text-xs font-mono text-primary shrink-0 w-12 pt-0.5">{fmt(s.start)}</span>
                    <span className="text-sm">{s.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="text-sm" />
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {view === 'timestamp' ? 'Timestamp + teks per segmen. "Copy" = teks dengan timestamp.' : 'Teks polos (bisa diedit). '}
              <b>.srt</b> = subtitle dengan timestamp buat upload ke YouTube.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
