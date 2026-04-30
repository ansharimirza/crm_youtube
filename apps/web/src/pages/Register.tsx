import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Youtube, Mail, Lock, User as UserIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth'
import { toast } from 'sonner'

export function RegisterPage() {
  const { user, loading, register } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (password.length < 6) {
      toast.error('Password minimal 6 karakter')
      return
    }

    setSubmitting(true)
    try {
      await register(email, password, name)
      toast.success('Registrasi berhasil!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registrasi gagal')
      setSubmitting(false)
    }
  }

  if (loading) return null
  if (user) return <Navigate to="/" replace />

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 rounded-2xl bg-primary/10 items-center justify-center mb-4">
            <Youtube className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Buat Akun Baru</h1>
          <p className="text-sm text-muted-foreground mt-1">Daftar untuk mulai mengelola YouTube kamu</p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nama</Label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="Nama lengkap kamu"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="pl-9"
                    autoComplete="name"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="kamu@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="pl-9"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Minimal 6 karakter"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="pl-9"
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </div>
              </div>

              <Button type="submit" disabled={submitting} className="w-full" size="lg">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Mendaftar...</> : 'Daftar'}
              </Button>
            </form>

            <div className="text-center text-sm text-muted-foreground">
              Sudah punya akun?{' '}
              <Link to="/login" className="text-primary hover:underline font-medium">
                Login di sini
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
