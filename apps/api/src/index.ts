import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
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
import { tiktokRoutes } from './routes/tiktok'
import { recoverPendingTiktokScenes } from './lib/tiktok-worker'
import { recoverPendingScenes } from './lib/scene-worker'

const PORT = Number(process.env.API_PORT ?? 3000)

// ===== File-based logging that persists across container restarts =====
const LOG_DIR = process.env.LOG_DIR || '/app/logs'
await mkdir(LOG_DIR, { recursive: true }).catch(() => {})

async function writeLog(level: 'info' | 'error', message: string, meta?: unknown) {
  const ts = new Date().toISOString()
  const file = level === 'error' ? 'error.log' : 'api.log'
  const line = `${ts} [${level.toUpperCase()}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`
  await appendFile(join(LOG_DIR, file), line).catch(() => {})
}

// Capture all console.error to file too
const origError = console.error
console.error = (...args: unknown[]) => {
  origError(...args)
  void writeLog('error', args.map(a => a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a)).join(' '))
}

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
  .use(tiktokRoutes)
  .onError(({ code, error, set, path, request }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      const detail = String(error)
      console.error('[VALIDATION]', request.method, path, detail)
      return { error: 'Validation failed', detail }
    }
    console.error('[API ERROR]', request.method, path, error)
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
recoverPendingTiktokScenes().catch(err => console.error('[tiktok-recover]', err))

export type App = typeof app
