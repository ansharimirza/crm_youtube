import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Upload, Settings, Youtube, LogOut, Users, Film, Wand2, Flame, FileText, Video, Sparkles, PersonStanding, Clapperboard, FileAudio, Scissors, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth'

interface NavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/upload', icon: Upload, label: 'Upload' },
  { to: '/veo', icon: Film, label: 'Veo Studio' },
  { to: '/faceless', icon: Clapperboard, label: 'Faceless Studio' },
  { to: '/clipper', icon: Scissors, label: 'Clipper' },
  { to: '/rakit-klip', icon: Package, label: 'Rakit Klip' },
  { to: '/tiktok-faceless', icon: Video, label: 'TikTok Faceless' },
  { to: '/transcribe', icon: FileAudio, label: 'Transcribe' },
  { to: '/tiktok', icon: Video, label: 'TikTok Studio' },
  { to: '/influencer', icon: Sparkles, label: 'AI Influencer' },
  { to: '/motion', icon: PersonStanding, label: 'Motion Studio' },
  { to: '/analyzer', icon: Wand2, label: 'Video to Prompt' },
  { to: '/virality', icon: Flame, label: 'Virality Score' },
  { to: '/resume', icon: FileText, label: 'Resume Generator' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/admin', icon: Users, label: 'Admin', adminOnly: true },
]

export function Sidebar() {
  const { user, logout } = useAuth()

  return (
    <aside className="hidden md:flex w-60 flex-col border-r bg-card/30 backdrop-blur">
      <div className="flex h-14 items-center gap-2 border-b px-5">
        <Youtube className="h-5 w-5 text-primary" />
        <span className="font-bold tracking-tight">YT CRM</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems
          .filter(item => !item.adminOnly || user?.role === 'admin')
          .map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center gap-3 rounded-lg p-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium flex items-center gap-1">
              {user?.name}
              {user?.role === 'admin' && (
                <span className="text-[9px] bg-primary/20 text-primary px-1 py-0 rounded">A</span>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="mt-2 w-full justify-start gap-2 text-muted-foreground" onClick={logout}>
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </aside>
  )
}
