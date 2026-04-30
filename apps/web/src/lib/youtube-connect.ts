// Helper untuk Connect YouTube Account flow

import { api } from '@/lib/api'

const STATE_KEY = 'ytcrm_yt_connect_state'

export async function startYouTubeConnect(returnTo: string = '/settings') {
  // Simpan return URL supaya setelah callback bisa balik ke halaman semula
  sessionStorage.setItem(STATE_KEY, returnTo)

  const redirectUri = `${window.location.origin}/youtube-callback`
  const { url } = await api.get<{ url: string }>(
    `/api/youtube-accounts/connect-url?redirect_uri=${encodeURIComponent(redirectUri)}`
  )
  window.location.href = url
}

export function getYouTubeConnectReturn(): string {
  const url = sessionStorage.getItem(STATE_KEY) || '/settings'
  sessionStorage.removeItem(STATE_KEY)
  return url
}
