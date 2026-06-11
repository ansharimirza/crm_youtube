import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Upload, Settings, Youtube, Layers, Users, Film, Wand2, Flame,
  Menu, LogOut, FileText, Video, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/auth'
import { NotificationsBell } from './NotificationsBell'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

interface NavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/upload', icon: Upload, label: 'Upload Video' },
  { to: '/bulk-upload', icon: Layers, label: 'Bulk Upload' },
  { to: '/veo', icon: Film, label: 'Veo Studio' },
  { to: '/tiktok', icon: Video, label: 'TikTok Studio' },
  { to: '/influencer', icon: Sparkles, label: 'AI Influencer' },
  { to: '/analyzer', icon: Wand2, label: 'Video to Prompt' },
  { to: '/virality', icon: Flame, label: 'Virality Score' },
  { to: '/resume', icon: FileText, label: 'Resume Generator' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/admin', icon: Users, label: 'Admin', adminOnly: true },
]

// Bottom nav items (4 yang paling sering dipakai)
const bottomNavItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/veo', icon: Film, label: 'Veo' },
  { to: '/virality', icon: Flame, label: 'Score' },
  { to: '/analyzer', icon: Wand2, label: 'Prompt' },
]

export function MobileTopbar() {
  const { user, logout } = useAuth()
  const filteredNavItems = navItems.filter(item => !item.adminOnly || user?.role === 'admin')

  return (
    <>
      <header className="md:hidden flex h-14 items-center justify-between border-b bg-card/30 backdrop-blur px-4 sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <Youtube className="h-5 w-5 text-primary" />
          <span className="font-bold">YT CRM</span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationsBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Menu">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {user?.name?.[0]?.toUpperCase() ?? 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{user?.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{user?.email}</div>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              {filteredNavItems.map(({ to, icon: Icon, label }) => (
                <DropdownMenuItem key={to} asChild>
                  <NavLink to={to} end={to === '/'} className="cursor-pointer">
                    <Icon className="h-4 w-4" />
                    {label}
                  </NavLink>
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="cursor-pointer text-red-400 focus:text-red-300">
                <LogOut className="h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Bottom quick-access nav: 4 fitur paling sering dipakai */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-card/95 backdrop-blur grid grid-cols-4">
        {bottomNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
