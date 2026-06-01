import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { db, users } from '../db'
import { authMiddleware } from '../middleware/auth'
import {
  uploadVideoToGemini,
  waitForFileActive,
  scoreVirality,
  deleteGeminiFile,
  GeminiError,
  type Platform,
} from '../lib/gemini'

const TMP_DIR = process.env.VIRALITY_TMP_DIR || join(process.env.UPLOAD_DIR || process.cwd(), 'virality-tmp')
await mkdir(TMP_DIR, { recursive: true })

async function getApiKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user?.geminiApiKey) return user.geminiApiKey
  return process.env.GEMINI_API_KEY ?? null
}

export const viralityRoutes = new Elysia({ prefix: '/api/virality' })
  .use(authMiddleware)
  .post('/score', async ({ body, user, set }) => {
    const apiKey = await getApiKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Gemini API key belum diatur. Set di Settings.' }
    }

    const file = body.video
    if (!file) {
      set.status = 400
      return { error: 'Video wajib diisi' }
    }

    const ext = file.name.split('.').pop() ?? 'mp4'
    const filename = `virality_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const filepath = join(TMP_DIR, filename)
    await Bun.write(filepath, file)

    let geminiFileName: string | null = null

    try {
      const mime = file.type || 'video/mp4'
      const platform = (body.platform ?? 'tiktok') as Platform
      const uploaded = await uploadVideoToGemini(filepath, mime, apiKey, file.name)
      geminiFileName = uploaded.name
      await waitForFileActive(uploaded.name, apiKey)
      const result = await scoreVirality(uploaded.uri, mime, apiKey, platform)
      return { ok: true, result, platform }
    } catch (err) {
      const msg = err instanceof GeminiError ? err.message : err instanceof Error ? err.message : String(err)
      console.error('[virality] Error:', msg)
      set.status = 500
      return { ok: false, error: msg }
    } finally {
      await unlink(filepath).catch(() => {})
      if (geminiFileName) await deleteGeminiFile(geminiFileName, apiKey)
    }
  }, {
    body: t.Object({
      video: t.File(),
      platform: t.Optional(t.Union([
        t.Literal('tiktok'),
        t.Literal('reels'),
        t.Literal('shorts'),
      ])),
    }),
  })
