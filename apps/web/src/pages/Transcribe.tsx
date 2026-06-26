import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileAudio, Loader2, Copy, Download, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export function TranscribePage() {
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [srt, setSrt] = useState('')
  const [copied, setCopied] = useState(false)

  const mutation = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('audio', file!)
      return api.post<{ text: string; srt: string }>('/api/tools/transcribe', fd)
    },
    onSuccess: (r) => {
      setText(r.text)
      setSrt(r.srt)
      toast.success('Transkrip selesai')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function download(content: string, name: string) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const baseName = (file?.name.replace(/\.[^.]+$/, '') || 'transcript')

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <FileAudio className="h-6 w-6 text-primary" /> Transcribe
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload audio → teks transkrip + SRT (buat caption/subtitle YouTube). Gratis (Groq Whisper).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Audio</CardTitle>
          <CardDescription>MP3, WAV, M4A, dll. Bahasa apa aja (auto-detect).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary"
            />
            {file && <span className="text-xs text-emerald-400 truncate">🔊 {file.name}</span>}
          </div>
          <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Mentranskrip...</> : <><FileAudio className="h-4 w-4" /> Transcribe</>}
          </Button>
        </CardContent>
      </Card>

      {text && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Hasil Transkrip</CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <><Check className="h-3.5 w-3.5" /> Tersalin</> : <><Copy className="h-3.5 w-3.5" /> Copy teks</>}
              </Button>
              <Button size="sm" variant="outline" onClick={() => download(text, `${baseName}.txt`)}>
                <Download className="h-3.5 w-3.5" /> .txt
              </Button>
              {srt && (
                <Button size="sm" variant="outline" onClick={() => download(srt, `${baseName}.srt`)}>
                  <Download className="h-3.5 w-3.5" /> .srt
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="text-sm" />
            <p className="text-xs text-muted-foreground mt-2">Bisa diedit sebelum copy/download. SRT (.srt) = subtitle dengan timestamp buat upload ke YouTube.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
