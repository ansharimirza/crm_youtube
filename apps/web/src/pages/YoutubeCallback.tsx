import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { getYouTubeConnectReturn } from '@/lib/youtube-connect'
import { toast } from 'sonner'

export function YoutubeCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')
  const [channel, setChannel] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const code = params.get('code')
    const errorParam = params.get('error')

    if (errorParam || !code) {
      setStatus('error')
      setError(errorParam || 'No authorization code')
      return
    }

    const redirectUri = `${window.location.origin}/youtube-callback`

    api.post<{ account: { channelTitle: string | null; email: string }; updated: boolean } | { error: string }>(
      '/api/youtube-accounts/connect',
      { code, redirect_uri: redirectUri }
    ).then((data) => {
      if ('error' in data) {
        setStatus('error')
        setError(data.error)
        return
      }
      setStatus('success')
      setChannel(data.account.channelTitle || data.account.email)
      toast.success(`Channel "${data.account.channelTitle || data.account.email}" berhasil dihubungkan`)
      setTimeout(() => navigate(getYouTubeConnectReturn(), { replace: true }), 1500)
    }).catch((err) => {
      setStatus('error')
      setError(err.message)
    })
  }, [params, navigate])

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 text-primary mx-auto animate-spin" />
              <h2 className="text-xl font-bold">Menghubungkan Channel...</h2>
              <p className="text-sm text-muted-foreground">Mohon tunggu sebentar</p>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
              <h2 className="text-xl font-bold">Berhasil!</h2>
              <p className="text-sm text-muted-foreground">
                Channel <strong>{channel}</strong> sudah terhubung
              </p>
            </>
          )}
          {status === 'error' && (
            <>
              <XCircle className="h-10 w-10 text-red-400 mx-auto" />
              <h2 className="text-xl font-bold">Gagal Menghubungkan</h2>
              <p className="text-sm text-muted-foreground break-words">{error}</p>
              <Button onClick={() => navigate('/settings')}>Kembali ke Settings</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
