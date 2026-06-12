import { Elysia, t } from 'elysia'
import { and, desc, eq } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { db, users, motionVideos } from '../db'
import { authMiddleware } from '../middleware/auth'
import { generateKling, getHistory, isTerminalStatus, GeminigenError } from '../lib/geminigen'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const MOTION_DIR = join(UPLOAD_DIR, 'motion')
await mkdir(MOTION_DIR, { recursive: true })

async function saveUpload(file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = join(MOTION_DIR, name)
  await Bun.write(path, file)
  return path
}

async function getGeminigenKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user?.geminigenApiKey) return user.geminigenApiKey
  return process.env.GEMINIGEN_API_KEY ?? null
}

const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 30 * 60_000

function isPermanentValidationError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('must be between') ||
    m.includes('invalid value') ||
    m.includes('validation failed') ||
    m.includes('not allowed') ||
    m.includes('unsupported') ||
    m.includes('content policy') ||
    m.includes('400 bad request')
  )
}

async function pollUntilDone(uuid: string, apiKey: string, videoId: number) {
  const start = Date.now()
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const history = await getHistory(uuid, apiKey)
    await db.update(motionVideos)
      .set({ progress: history.status_percentage ?? 0, updatedAt: new Date() })
      .where(eq(motionVideos.id, videoId))
    if (isTerminalStatus(history.status)) return history
  }
  throw new GeminigenError('Polling timeout')
}

async function runMotion(videoId: number) {
  const mv = await db.query.motionVideos.findFirst({ where: eq(motionVideos.id, videoId) })
  if (!mv) return

  const apiKey = await getGeminigenKey(mv.userId)
  if (!apiKey) {
    await db.update(motionVideos).set({
      status: 'error',
      errorMsg: 'GeminiGen API key belum diatur. Set di Settings.',
      updatedAt: new Date(),
    }).where(eq(motionVideos.id, videoId))
    return
  }

  try {
    await db.update(motionVideos).set({
      status: 'processing',
      attempts: (mv.attempts ?? 0) + 1,
      progress: 0,
      errorMsg: null,
      updatedAt: new Date(),
    }).where(eq(motionVideos.id, videoId))

    const generated = await generateKling({
      apiKey,
      prompt: mv.prompt || 'Animate the character following the reference video motion exactly.',
      model: 'kling-video-motion-3',
      // 1080p = professional, 720p = standard — Kling determines duration from the
      // reference video automatically for motion-control models.
      mode: mv.resolution === '1080p' ? 'professional' : 'standard',
      aspectRatio: mv.aspectRatio as '16:9' | '9:16' | '1:1',
      refImagePaths: [mv.characterImagePath],
      refVideoPaths: [mv.referenceVideoPath],
    })

    await db.update(motionVideos).set({
      geminigenUuid: generated.uuid,
      updatedAt: new Date(),
    }).where(eq(motionVideos.id, videoId))

    const history = await pollUntilDone(generated.uuid, apiKey, videoId)

    if (history.status === 2) {
      const video = history.generated_video?.[0]
      await db.update(motionVideos).set({
        status: 'done',
        progress: 100,
        videoUrl: video?.video_url ?? null,
        thumbnailUrl: history.thumbnail_urls?.[0] ?? null,
        errorMsg: null,
        updatedAt: new Date(),
      }).where(eq(motionVideos.id, videoId))
      console.log(`[motion:${videoId}] DONE`)
      return
    }

    const errMsg = history.error_message || history.status_desc || 'Generation failed'
    await db.update(motionVideos).set({
      status: 'error',
      errorMsg: errMsg,
      updatedAt: new Date(),
    }).where(eq(motionVideos.id, videoId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[motion:${videoId}]`, msg)
    const isValidation = isPermanentValidationError(msg)
    await db.update(motionVideos).set({
      status: 'error',
      errorMsg: isValidation ? `Validation error (no retry): ${msg}` : msg,
      updatedAt: new Date(),
    }).where(eq(motionVideos.id, videoId))
  }
}

export const motionRoutes = new Elysia({ prefix: '/api/motion' })
  .use(authMiddleware)

  .post('/', async ({ body, user, set }) => {
    if (!body.character_image || !body.reference_video) {
      set.status = 400
      return { error: 'Character image dan reference video wajib' }
    }

    // Validate against Kling motion-control real limits (per docs + geminigen web UI)
    if (body.character_image.size > 15 * 1024 * 1024) {
      set.status = 400
      return { error: 'Foto karakter terlalu besar — max 15MB' }
    }
    if (body.reference_video.size > 50 * 1024 * 1024) {
      set.status = 400
      return { error: 'Video referensi terlalu besar — max 50MB' }
    }

    const characterImagePath = await saveUpload(body.character_image, 'character')
    const referenceVideoPath = await saveUpload(body.reference_video, 'refvideo')

    const [mv] = await db.insert(motionVideos).values({
      userId: user.id,
      title: body.title ?? '',
      characterImagePath,
      referenceVideoPath,
      prompt: body.prompt ?? '',
      aspectRatio: (body.aspect_ratio ?? '9:16') as '16:9' | '9:16' | '1:1',
      resolution: (body.resolution ?? '720p') as '720p' | '1080p',
      model: 'kling-video-motion-3',
      status: 'queued',
    }).returning()

    runMotion(mv.id).catch((err) => console.error('[motion:bg]', err))
    return { ok: true, motion: mv }
  }, {
    body: t.Object({
      title: t.Optional(t.String({ maxLength: 200 })),
      character_image: t.File(),
      reference_video: t.File(),
      prompt: t.Optional(t.String({ maxLength: 2000 })),
      aspect_ratio: t.Optional(t.Union([t.Literal('16:9'), t.Literal('9:16'), t.Literal('1:1')])),
      resolution: t.Optional(t.Union([t.Literal('720p'), t.Literal('1080p')])),
    }),
  })

  .get('/', async ({ user }) => {
    const list = await db.query.motionVideos.findMany({
      where: eq(motionVideos.userId, user.id),
      orderBy: [desc(motionVideos.createdAt)],
    })
    return { videos: list }
  })

  .get('/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const mv = await db.query.motionVideos.findFirst({
      where: and(eq(motionVideos.id, id), eq(motionVideos.userId, user.id)),
    })
    if (!mv) {
      set.status = 404
      return { error: 'Motion video tidak ditemukan' }
    }
    return { motion: mv }
  })

  .post('/:id/retry', async ({ params, user, set }) => {
    const id = Number(params.id)
    const mv = await db.query.motionVideos.findFirst({
      where: and(eq(motionVideos.id, id), eq(motionVideos.userId, user.id)),
    })
    if (!mv) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.update(motionVideos).set({
      status: 'queued',
      progress: 0,
      attempts: 0,
      errorMsg: null,
      videoUrl: null,
      thumbnailUrl: null,
      geminigenUuid: null,
      updatedAt: new Date(),
    }).where(eq(motionVideos.id, id))
    runMotion(id).catch((err) => console.error('[motion:bg]', err))
    return { ok: true }
  })

  .delete('/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const existing = await db.query.motionVideos.findFirst({
      where: and(eq(motionVideos.id, id), eq(motionVideos.userId, user.id)),
    })
    if (!existing) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.delete(motionVideos).where(eq(motionVideos.id, id))
    return { ok: true }
  })

export async function recoverPendingMotion() {
  const pending = await db.query.motionVideos.findMany({
    where: (m, { or, eq }) => or(eq(m.status, 'queued'), eq(m.status, 'processing')),
  })
  for (const m of pending) {
    console.log(`[motion] Recovering #${m.id}`)
    runMotion(m.id).catch((err) => console.error('[motion]', err))
  }
}
