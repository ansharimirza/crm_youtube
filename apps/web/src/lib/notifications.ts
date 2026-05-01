// Browser notification helpers (Notification API)

export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): NotificationPermission {
  return canNotify() ? Notification.permission : 'denied'
}

export async function requestNotifyPermission(): Promise<NotificationPermission> {
  if (!canNotify()) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return await Notification.requestPermission()
}

export function showBrowserNotification(title: string, body: string, url?: string) {
  if (!canNotify() || Notification.permission !== 'granted') return
  const notif = new Notification(title, {
    body,
    icon: '/favicon.svg',
    tag: 'ytcrm',
  })
  if (url) {
    notif.onclick = () => {
      window.focus()
      window.location.href = url
      notif.close()
    }
  }
}
