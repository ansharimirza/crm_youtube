import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Force-refresh the app whenever a new build is deployed. The PWA service worker
// (registerType: 'autoUpdate') skipWaiting()s the new SW; when it takes control we
// reload so the user never gets stuck on a stale cached bundle. We also poll for
// updates so an already-open tab picks up a deploy within ~30s without a manual refresh.
if ('serviceWorker' in navigator) {
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
  navigator.serviceWorker.ready.then((reg) => {
    setInterval(() => reg.update().catch(() => {}), 30_000)
  }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
