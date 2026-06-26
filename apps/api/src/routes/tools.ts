// Standalone tools (JWT-authed). Currently: audio → transcript (Groq Whisper).

import { Elysia, t } from 'elysia'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { authMiddleware } from '../middleware/auth'
import { transcribeAudio } from '../lib/transcribe'

export const toolsRoutes = new Elysia({ prefix: '/api/tools' })
  .use(authMiddleware)
  // Upload an audio file → plain transcript + SRT (for YouTube captions).
  .post('/transcribe', async ({ body, set }) => {
    const file = body.audio
    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase()
    const tmp = join(tmpdir(), `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`)
    await Bun.write(tmp, file)
    try {
      const { text, srt, segments } = await transcribeAudio(tmp)
      return { ok: true, text, srt, segments }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal transcribe' }
    } finally {
      await rm(tmp, { force: true }).catch(() => {})
    }
  }, { body: t.Object({ audio: t.File() }) })
