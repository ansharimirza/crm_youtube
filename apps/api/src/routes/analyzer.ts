import { Elysia, t } from 'elysia'
import { and, eq, max } from 'drizzle-orm'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { db, users, veoProjects, veoScenes } from '../db'
import { authMiddleware } from '../middleware/auth'
import { enqueueScene } from '../lib/scene-worker'
import {
  uploadVideoToGemini,
  waitForFileActive,
  analyzeVideoForVeo,
  deleteGeminiFile,
  GeminiError,
} from '../lib/gemini'

const TMP_DIR = process.env.ANALYZER_TMP_DIR || join(process.env.UPLOAD_DIR || process.cwd(), 'analyzer-tmp')
await mkdir(TMP_DIR, { recursive: true })

async function getApiKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user?.geminiApiKey) return user.geminiApiKey
  return process.env.GEMINI_API_KEY ?? null
}

export const analyzerRoutes = new Elysia({ prefix: '/api/analyzer' })
  .use(authMiddleware)
  .post('/analyze', async ({ body, user, set }) => {
    const apiKey = await getApiKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Gemini API key belum diatur. Set di Settings.' }
    }

    const file = body.video
    if (!file) {
      set.status = 400
      return { error: 'Video file wajib diisi' }
    }

    // Simpan tmp
    const ext = file.name.split('.').pop() ?? 'mp4'
    const filename = `analyze_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const filepath = join(TMP_DIR, filename)
    await Bun.write(filepath, file)

    let geminiFileName: string | null = null

    try {
      const mime = file.type || 'video/mp4'

      // Upload ke Gemini
      const uploaded = await uploadVideoToGemini(filepath, mime, apiKey, file.name)
      geminiFileName = uploaded.name

      // Tunggu active
      await waitForFileActive(uploaded.name, apiKey)

      // Analisa
      const result = await analyzeVideoForVeo(uploaded.uri, mime, apiKey)

      // Clamp duration ke 4/6/8 (Veo hanya support nilai ini)
      const allowed = [4, 6, 8] as const
      result.scenes = result.scenes.map(s => {
        const d = Number(s.duration_suggested) || 4
        const nearest = allowed.reduce((prev, curr) =>
          Math.abs(curr - d) < Math.abs(prev - d) ? curr : prev
        )
        return { ...s, duration_suggested: nearest }
      })

      return { ok: true, result }
    } catch (err) {
      const msg = err instanceof GeminiError ? err.message : err instanceof Error ? err.message : String(err)
      console.error('[analyzer] Error:', msg)
      set.status = 500
      return { ok: false, error: msg }
    } finally {
      await unlink(filepath).catch(() => {})
      if (geminiFileName) {
        await deleteGeminiFile(geminiFileName, apiKey)
      }
    }
  }, {
    body: t.Object({
      video: t.File(),
    }),
  })
  // Add scenes hasil analisa ke project Veo
  .post('/add-to-project', async ({ body, user, set }) => {
    const projectId = Number(body.project_id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, projectId), eq(veoProjects.userId, user.id)),
    })
    if (!project) {
      set.status = 404
      return { error: 'Project tidak ditemukan' }
    }

    // Validasi scenes
    if (!Array.isArray(body.scenes) || body.scenes.length === 0) {
      set.status = 400
      return { error: 'Scenes kosong' }
    }

    // Cari next scene number
    const [maxRow] = await db.select({ max: max(veoScenes.sceneNumber) })
      .from(veoScenes).where(eq(veoScenes.projectId, projectId))
    let nextNum = (maxRow.max ?? 0) + 1

    const allowedDurations = [4, 6, 8] as const
    const created: number[] = []
    for (const s of body.scenes) {
      // Resolution: pakai override global kalau ada, kalau tidak default 720p
      const resolution = body.resolution ?? '720p'

      // Model: pakai override global kalau ada, kalau tidak pakai saran AI per-scene
      const model = (body.model ?? s.veo_model_suggested ?? 'veo-2') as 'veo-2' | 'veo-3.1' | 'veo-3.1-fast' | 'veo-3.1-lite'

      // Duration: clamp ke 4/6/8
      const d = Number(s.duration_suggested) || 4
      const duration = allowedDurations.reduce((prev, curr) =>
        Math.abs(curr - d) < Math.abs(prev - d) ? curr : prev
      )

      const [scene] = await db.insert(veoScenes).values({
        projectId,
        sceneNumber: nextNum++,
        prompt: s.video_prompt,
        model,
        aspectRatio: body.aspect_ratio ?? '16:9',
        resolution,
        duration,
        modeImage: 'frame',
        status: 'queued',
      }).returning()
      created.push(scene.id)
      if (body.auto_start !== false) enqueueScene(scene.id)
    }

    return { ok: true, created }
  }, {
    body: t.Object({
      project_id: t.Number(),
      auto_start: t.Optional(t.Boolean()),
      aspect_ratio: t.Optional(t.Union([t.Literal('16:9'), t.Literal('9:16')])),
      resolution: t.Optional(t.Union([t.Literal('720p'), t.Literal('1080p')])),
      model: t.Optional(t.Union([
        t.Literal('veo-2'), t.Literal('veo-3.1'),
        t.Literal('veo-3.1-fast'), t.Literal('veo-3.1-lite'),
      ])),
      scenes: t.Array(t.Object({
        video_prompt: t.String({ minLength: 1 }),
        image_prompt: t.Optional(t.String()),
        duration_suggested: t.Optional(t.Integer()),
        veo_model_suggested: t.Optional(t.String()),
      })),
    }),
  })
