import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { authRoutes } from './routes/auth'
import { videoRoutes, systemRoutes } from './routes/videos'
import { metaRoutes } from './routes/meta'
import { youtubeAccountRoutes } from './routes/youtube-accounts'

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
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'Validation failed', detail: String(error) }
    }
    console.error('[API ERROR]', error)
    set.status = set.status === 200 ? 500 : set.status
    return { error: error instanceof Error ? error.message : 'Internal error' }
  })
  .listen({ port: PORT, hostname: '0.0.0.0' })

console.log(`🚀 API listening on http://0.0.0.0:${PORT}`)

export type App = typeof app
