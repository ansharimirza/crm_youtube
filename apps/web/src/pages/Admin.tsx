import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Trash2, Shield, ShieldOff, UserPlus, Video as VideoIcon, Youtube, Database, KeyRound, Power, Pencil, X, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth'
import type { User } from '@/lib/types'

interface AdminStats {
  users: number
  videos: number
  channels: number
  videosUploaded: number
}

export function AdminPage() {
  const { user: currentUser } = useAuth()
  const qc = useQueryClient()
  const [showAddForm, setShowAddForm] = useState(false)

  const { data: usersData } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ users: User[] }>('/api/admin/users'),
  })
  const users = usersData?.users ?? []

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<AdminStats>('/api/admin/stats'),
    refetchInterval: 30000,
  })

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola user dan sistem</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          <UserPlus className="h-4 w-4" />
          {showAddForm ? 'Tutup Form' : 'Tambah User'}
        </Button>
      </div>

      {/* System stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users}     label="Users"           value={stats?.users ?? 0} />
        <StatCard icon={Youtube}   label="Channels"        value={stats?.channels ?? 0} />
        <StatCard icon={VideoIcon} label="Total Videos"    value={stats?.videos ?? 0} />
        <StatCard icon={Database}  label="Videos Uploaded" value={stats?.videosUploaded ?? 0} />
      </div>

      {/* Add user form */}
      {showAddForm && (
        <AddUserForm onClose={() => setShowAddForm(false)} onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['admin-users'] })
          qc.invalidateQueries({ queryKey: ['admin-stats'] })
          setShowAddForm(false)
        }} />
      )}

      {/* User list */}
      <Card>
        <CardHeader>
          <CardTitle>Users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Belum ada user</div>
          ) : (
            <div className="divide-y">
              {users.map(u => (
                <UserRow key={u.id} user={u} isCurrentUser={u.id === currentUser?.id} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-primary" />
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AddUserForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user' as 'user' | 'admin' })

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/api/admin/users', data),
    onSuccess: () => {
      toast.success(`User "${form.name}" berhasil dibuat`)
      onSuccess()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    createMutation.mutate(form)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tambah User Baru</CardTitle>
        <CardDescription>User akan langsung bisa login dengan email/password ini</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Nama</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label>Password (min 6)</Label>
            <Input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} minLength={6} required />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={v => setForm({ ...form, role: v as 'user' | 'admin' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex gap-2 mt-2">
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Membuat...' : 'Buat User'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function UserRow({ user, isCurrentUser }: { user: User; isCurrentUser: boolean }) {
  const qc = useQueryClient()
  const [showResetPw, setShowResetPw] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [editName, setEditName] = useState(user.name)
  const [editEmail, setEditEmail] = useState(user.email)

  const updateMutation = useMutation({
    mutationFn: (data: Partial<User> & { password?: string }) =>
      api.patch(`/api/admin/users/${user.id}`, data),
    onSuccess: () => {
      toast.success('User diperbarui')
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      setShowResetPw(false)
      setNewPassword('')
      setShowEdit(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function saveEdit() {
    const updates: Partial<User> = {}
    if (editName.trim() && editName.trim() !== user.name) updates.name = editName.trim()
    if (editEmail.trim() && editEmail.trim() !== user.email) updates.email = editEmail.trim()
    if (Object.keys(updates).length === 0) {
      toast.info('Tidak ada perubahan')
      setShowEdit(false)
      return
    }
    updateMutation.mutate(updates)
  }

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/admin/users/${user.id}`),
    onSuccess: () => {
      toast.success(`User "${user.name}" dihapus`)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-stats'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function toggleRole() {
    updateMutation.mutate({ role: user.role === 'admin' ? 'user' : 'admin' })
  }
  function toggleActive() {
    updateMutation.mutate({ isActive: !user.isActive })
  }
  function resetPassword() {
    if (newPassword.length < 6) {
      toast.error('Password minimal 6 karakter')
      return
    }
    updateMutation.mutate({ password: newPassword })
  }
  function handleDelete() {
    if (confirm(`Hapus user "${user.name}"? Semua videonya juga akan terhapus.`)) {
      deleteMutation.mutate()
    }
  }

  return (
    <div className="px-5 py-4 hover:bg-accent/30 transition-colors">
      <div className="flex items-center gap-4">
        <div className={cn(
          'h-10 w-10 rounded-full flex items-center justify-center font-bold shrink-0',
          user.role === 'admin' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
        )}>
          {user.name?.[0]?.toUpperCase() ?? 'U'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{user.name}</span>
            {user.role === 'admin' && <Badge variant="default">Admin</Badge>}
            {!user.isActive && <Badge variant="destructive">Disabled</Badge>}
            {isCurrentUser && <Badge variant="secondary">Kamu</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{user.email}</span>
            <span>•</span>
            <span>{user.videoCount ?? 0} videos</span>
            <span>•</span>
            <span>{user.channelCount ?? 0} channels</span>
            {user.createdAt && (
              <>
                <span>•</span>
                <span>Daftar {formatRelativeTime(user.createdAt)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setEditName(user.name); setEditEmail(user.email); setShowEdit(v => !v) }}
            title="Edit nama / email"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          {!isCurrentUser && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleRole}
                title={user.role === 'admin' ? 'Demote ke user' : 'Promote ke admin'}
                disabled={updateMutation.isPending}
              >
                {user.role === 'admin' ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleActive}
                title={user.isActive ? 'Disable user' : 'Enable user'}
                disabled={updateMutation.isPending}
              >
                <Power className={cn('h-4 w-4', !user.isActive && 'text-red-400')} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowResetPw(!showResetPw)}
                title="Reset password"
              >
                <KeyRound className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleDelete}
                title="Hapus user"
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {showEdit && (
        <div className="mt-3 grid sm:grid-cols-2 gap-2 pl-14">
          <Input
            placeholder="Nama"
            value={editName}
            onChange={e => setEditName(e.target.value)}
          />
          <Input
            type="email"
            placeholder="Email"
            value={editEmail}
            onChange={e => setEditEmail(e.target.value)}
          />
          <div className="sm:col-span-2 flex gap-2">
            <Button size="sm" onClick={saveEdit} disabled={updateMutation.isPending}>
              <Check className="h-4 w-4" />
              Simpan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowEdit(false)}>
              <X className="h-4 w-4" />
              Batal
            </Button>
          </div>
        </div>
      )}

      {showResetPw && (
        <div className="mt-3 flex gap-2 pl-14">
          <Input
            type="text"
            placeholder="Password baru (min 6 karakter)"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="flex-1"
          />
          <Button size="sm" onClick={resetPassword} disabled={updateMutation.isPending}>
            Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowResetPw(false); setNewPassword('') }}>
            Batal
          </Button>
        </div>
      )}
    </div>
  )
}
