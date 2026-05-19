import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Film, Trash2, Loader2, CheckCircle2, AlertCircle, KeyRound, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { formatRelativeTime, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth'
import type { VeoProjectSummary } from '@/lib/types'

export function VeoStudioPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const { data } = useQuery({
    queryKey: ['veo-projects'],
    queryFn: () => api.get<{ projects: VeoProjectSummary[] }>('/api/veo/projects'),
    refetchInterval: 5000,
  })
  const projects = data?.projects ?? []

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/veo/projects/${id}`),
    onSuccess: () => {
      toast.success('Project dihapus')
      qc.invalidateQueries({ queryKey: ['veo-projects'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Film className="h-6 w-6 text-primary" />
            Veo Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Generate video AI dengan Veo (GeminiGen.AI)</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" />
          {showForm ? 'Tutup Form' : 'Project Baru'}
        </Button>
      </div>

      {/* API Key warning */}
      {!user?.hasGeminigenKey && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <KeyRound className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-amber-300">GeminiGen API Key belum diatur</p>
                <p className="text-muted-foreground text-xs mt-1">
                  Atur dulu di Settings sebelum bisa generate video.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/settings">
                    Ke Settings →
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showForm && (
        <CreateProjectForm onClose={() => setShowForm(false)} onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['veo-projects'] })
          setShowForm(false)
        }} />
      )}

      {/* Project list */}
      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Film className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">Belum ada project</p>
            <Button onClick={() => setShowForm(true)} className="mt-4" size="sm">
              <Plus className="h-4 w-4" />
              Buat Project Pertama
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={() => {
                if (confirm(`Hapus project "${project.title}"? Semua scene-nya juga akan terhapus.`)) {
                  deleteMutation.mutate(project.id)
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CreateProjectForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const mutation = useMutation({
    mutationFn: (data: { title: string; description: string }) =>
      api.post<{ project: { id: number } }>('/api/veo/projects', data),
    onSuccess: () => {
      toast.success('Project dibuat')
      onSuccess()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate({ title, description })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Project Baru</CardTitle>
        <CardDescription>Project = kumpulan scene video Veo</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Judul</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Misal: Promo Produk Akhir Tahun"
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label>Deskripsi (opsional)</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Catatan tentang project ini..."
              rows={3}
              maxLength={1000}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Membuat...' : 'Buat Project'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function ProjectCard({ project, onDelete }: { project: VeoProjectSummary; onDelete: () => void }) {
  const hasActivity = project.processingCount > 0

  return (
    <Card className="hover:border-primary/40 transition-colors group">
      <CardContent className="p-0">
        <Link to={`/veo/${project.id}`} className="block">
          <div className="relative aspect-video bg-gradient-to-br from-primary/10 to-purple-500/10 rounded-t-xl overflow-hidden">
            {project.thumbnail ? (
              <img src={project.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Film className="h-12 w-12 text-primary/40" />
              </div>
            )}
            {hasActivity && (
              <div className="absolute top-2 right-2 bg-blue-500/90 backdrop-blur text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {project.processingCount}
              </div>
            )}
          </div>

          <div className="p-4">
            <h3 className="font-medium truncate group-hover:text-primary transition-colors">
              {project.title}
            </h3>
            {project.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{project.description}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3">
              <span className="inline-flex items-center gap-1">
                <Film className="h-3 w-3" />
                {project.sceneCount} scene
              </span>
              {project.doneCount > 0 && (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  {project.doneCount}
                </span>
              )}
              {project.errorCount > 0 && (
                <span className="inline-flex items-center gap-1 text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  {project.errorCount}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground/60 mt-1">{formatRelativeTime(project.createdAt)}</div>
          </div>
        </Link>

        <div className="border-t flex items-center justify-end gap-1 px-2 py-1">
          <Button asChild size="sm" variant="ghost" className="h-8">
            <Link to={`/veo/${project.id}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              Buka
            </Link>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={cn('h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10')}
            onClick={onDelete}
            title="Hapus"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
