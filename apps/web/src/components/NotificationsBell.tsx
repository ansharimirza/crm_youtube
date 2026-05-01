import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, CheckCheck } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import {
  canNotify,
  notificationPermission,
  requestNotifyPermission,
  showBrowserNotification,
} from '@/lib/notifications'
import { formatRelativeTime, cn } from '@/lib/utils'
import type { Notification } from '@/lib/types'

export function NotificationsBell() {
  const qc = useQueryClient()
  const lastSeenIdRef = useRef<number>(0)

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ notifications: Notification[]; unreadCount: number }>('/api/notifications'),
    refetchInterval: 10_000,
  })

  const list = data?.notifications ?? []
  const unread = data?.unreadCount ?? 0

  // Show browser notification untuk yang baru
  useEffect(() => {
    if (!list.length) return
    if (lastSeenIdRef.current === 0) {
      lastSeenIdRef.current = list[0].id
      return
    }
    const newOnes = list.filter(n => n.id > lastSeenIdRef.current)
    for (const n of newOnes) {
      if (!n.isRead) {
        showBrowserNotification(n.title, n.message, '/')
      }
    }
    if (newOnes.length > 0) lastSeenIdRef.current = list[0].id
  }, [list])

  const markRead = useMutation({
    mutationFn: (ids?: number[]) => api.post('/api/notifications/mark-read', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const requestPermission = async () => {
    await requestNotifyPermission()
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const perm = canNotify() ? notificationPermission() : 'unsupported'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <span className="text-sm font-semibold">Notifikasi</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => markRead.mutate(undefined)}>
              <CheckCheck className="h-3 w-3" />
              Tandai dibaca
            </Button>
          )}
        </div>

        {perm !== 'granted' && perm !== 'unsupported' && (
          <button
            onClick={requestPermission}
            className="w-full flex items-center gap-2 border-b p-3 text-xs text-left hover:bg-accent transition-colors"
          >
            <BellOff className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-muted-foreground">
              Klik untuk aktifkan notifikasi browser saat upload selesai
            </span>
          </button>
        )}

        <div className="max-h-96 overflow-y-auto">
          {list.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Belum ada notifikasi
            </div>
          ) : (
            list.map(n => (
              <div
                key={n.id}
                className={cn(
                  'border-b p-3 hover:bg-accent/50 transition-colors cursor-pointer',
                  !n.isRead && 'bg-primary/5'
                )}
                onClick={() => !n.isRead && markRead.mutate([n.id])}
              >
                <div className="flex items-start gap-2">
                  {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.message}</div>
                    <div className="text-[10px] text-muted-foreground/70 mt-1">{formatRelativeTime(n.createdAt)}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
