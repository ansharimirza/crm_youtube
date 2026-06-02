import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import { db, users } from '../db'
import { authMiddleware } from '../middleware/auth'
import { parseResume, GeminiError } from '../lib/gemini'

async function getApiKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user?.geminiApiKey) return user.geminiApiKey
  return process.env.GEMINI_API_KEY ?? null
}

export const resumeRoutes = new Elysia({ prefix: '/api/resume' })
  .use(authMiddleware)
  .post('/parse', async ({ body, user, set }) => {
    const apiKey = await getApiKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Gemini API key belum diatur. Set di Settings.' }
    }

    if (!body.text || !body.text.trim()) {
      set.status = 400
      return { error: 'Teks resume kosong' }
    }

    try {
      const parsed = await parseResume(body.text, apiKey)
      return { ok: true, resume: parsed }
    } catch (err) {
      const msg = err instanceof GeminiError ? err.message : err instanceof Error ? err.message : String(err)
      console.error('[resume parse]', msg)
      set.status = 500
      return { ok: false, error: msg }
    }
  }, {
    body: t.Object({
      text: t.String({ minLength: 1, maxLength: 50000 }),
    }),
  })
