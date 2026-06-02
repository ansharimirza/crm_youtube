import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { authRoutes } from './routes/auth'
import { videoRoutes, systemRoutes } from './routes/videos'
import { metaRoutes } from './routes/meta'
import { youtubeAccountRoutes } from './routes/youtube-accounts'
import { notificationRoutes } from './routes/notifications'
import { adminRoutes } from './routes/admin'
import { veoRoutes } from './routes/veo'
import { analyzerRoutes } from './routes/analyzer'
import { viralityRoutes } from './routes/virality'
import { resumeRoutes } from './routes/resume'
import { recoverPendingScenes } from './lib/scene-worker'

const PORT = Number(process.env.API_PORT ?? 3000)

const app = new Elysia()
  .use(cors({ origin: true, credentials: true }))
  .get('/', () => ({ name: 'ytcrm-api', status: 'ok' }))
  .get('/health', () => ({ ok: true, ts: Date.now() }))
  .use(authRoutes)
  .use(videoRoutes)
  .use(systemRoutes)
  .use(metaRoutes)
  .use(youtubeAccountRoutes)
  .use(notificationRoutes)
  .use(adminRoutes)
  .use(veoRoutes)
  .use(analyzerRoutes)
  .use(viralityRoutes)
  .use(resumeRoutes)
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'Validation failed', detail: String(error) }
    }
    console.error('[API ERROR]', error)
    set.status = set.status === 200 ? 500 : set.status
    return { error: error instanceof Error ? error.message : 'Internal error' }
  })
  .listen({
    port: PORT,
    hostname: '0.0.0.0',
    maxRequestBodySize: 2 * 1024 * 1024 * 1024, // 2GB untuk upload video besar
    idleTimeout: 0, // disable idle timeout (default 10s) supaya upload lama gak putus
  })

console.log(`🚀 API listening on http://0.0.0.0:${PORT}`)

// Recover scenes yang pending kalau API restart
recoverPendingScenes().catch(err => console.error('[recover]', err))

export type App = typeof app
