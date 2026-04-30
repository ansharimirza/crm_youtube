import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Upload, Settings, Youtube } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/upload', icon: Upload, label: 'Upload' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function MobileTopbar() {
  return (
    <>
      <header className="md:hidden flex h-14 items-center justify-between border-b bg-card/30 backdrop-blur px-4 sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <Youtube className="h-5 w-5 text-primary" />
          <span className="font-bold">YT CRM</span>
        </div>
      </header>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-card/95 backdrop-blur grid grid-cols-3">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 py-2.5 text-xs font-medium',
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
