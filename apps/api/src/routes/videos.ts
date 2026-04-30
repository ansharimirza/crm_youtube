import { Elysia, t } from 'elysia'
import { and, desc, eq } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { db, videos, uploadLogs, youtubeAccounts } from '../db'
import { authMiddleware } from '../middleware/auth'
import { uploadViaWorker, workerHealth } from '../lib/worker'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
await mkdir(UPLOAD_DIR, { recursive: true })

async function saveFile(file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const filepath = join(UPLOAD_DIR, filename)
  await Bun.write(filepath, file)
  return filepath
}

async function log(videoId: number, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  await db.insert(uploadLogs).values({ videoId, message, level })
}

async function runUpload(videoId: number) {
  const video = await db.query.videos.findFirst({
    where: eq(videos.id, videoId),
    with: { youtubeAccount: true },
  })
  if (!video) return
  if (!video.youtubeAccount) {
    await db.update(videos)
      .set({ status: 'error', errorMsg: 'YouTube account tidak ditemukan', updatedAt: new Date() })
      .where(eq(videos.id, videoId))
    await log(videoId, 'YouTube account tidak ditemukan', 'error')
    return
  }

  try {
    await db.update(videos)
      .set({ status: 'uploading', errorMsg: null, updatedAt: new Date() })
      .where(eq(videos.id, videoId))
    await log(videoId, `Upload dimulai ke channel: ${video.youtubeAccount.channelTitle ?? video.youtubeAccount.email}`)

    const result = await uploadViaWorker({
      videoPath: video.videoPath,
      thumbnailPath: video.thumbnailPath,
      title: video.title,
      description: video.description,
      tags: video.tags.split(',').map(t => t.trim()).filter(Boolean),
      categoryId: video.categoryId,
      privacy: video.privacy as 'public' | 'private' | 'unlisted',
      language: video.language,
      madeForKids: video.madeForKids,
      accessToken: video.youtubeAccount.accessToken,
      refreshToken: video.youtubeAccount.refreshToken,
    })

    if (result.ok) {
      await db.update(videos)
        .set({
          status: 'done',
          progress: 100,
          youtubeId: result.videoId,
          youtubeUrl: result.url,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(videos.id, videoId))
      await log(videoId, `Upload selesai: ${result.url}`)
    } else {
      throw new Error(result.error)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.update(videos)
      .set({ status: 'error', errorMsg: msg, updatedAt: new Date() })
      .where(eq(videos.id, videoId))
    await log(videoId, `Error: ${msg}`, 'error')
  }
}

export const videoRoutes = new Elysia({ prefix: '/api/videos' })
  .use(authMiddleware)
  .get('/', async ({ user }) => {
    const list = await db.query.videos.findMany({
      where: eq(videos.userId, user.id),
      orderBy: [desc(videos.createdAt)],
      limit: 200,
      with: {
        youtubeAccount: {
          columns: { id: true, email: true, name: true, channelTitle: true, avatarUrl: true },
        },
      },
    })
    return { videos: list }
  })
  .get('/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const video = await db.query.videos.findFirst({
      where: and(eq(videos.id, id), eq(videos.userId, user.id)),
      with: {
        youtubeAccount: {
          columns: { id: true, email: true, name: true, channelTitle: true },
        },
      },
    })
    if (!video) {
      set.status = 404
      return { error: 'Not found' }
    }
    const logs = await db.query.uploadLogs.findMany({
      where: eq(uploadLogs.videoId, id),
      orderBy: [desc(uploadLogs.createdAt)],
      limit: 100,
    })
    return { video, logs }
  })
  .post(
    '/',
    async ({ body, user, set }) => {
      const ytAccountId = Number(body.youtube_account_id)
      const ytAccount = await db.query.youtubeAccounts.findFirst({
        where: and(eq(youtubeAccounts.id, ytAccountId), eq(youtubeAccounts.userId, user.id)),
      })
      if (!ytAccount) {
        set.status = 400
        return { error: 'YouTube account tidak valid' }
      }

      const videoFile = body.video
      const thumbFile = body.thumbnail

      const videoPath = await saveFile(videoFile, 'video')
      const thumbPath = thumbFile ? await saveFile(thumbFile, 'thumb') : null

      const tagsArr = (body.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)
      const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null

      const [video] = await db.insert(videos).values({
        userId: user.id,
        youtubeAccountId: ytAccount.id,
        title: body.title,
        description: body.description ?? '',
        tags: tagsArr.join(','),
        categoryId: body.category_id ?? '22',
        privacy: (body.privacy ?? 'public') as 'public' | 'private' | 'unlisted',
        language: body.language ?? 'en',
        madeForKids: body.made_for_kids === 'true',
        videoPath,
        fileName: videoFile.name,
        fileSize: videoFile.size,
        thumbnailPath: thumbPath,
        status: scheduledAt ? 'scheduled' : 'queued',
        scheduledAt,
      }).returning()

      if (!scheduledAt) {
        queueMicrotask(() => runUpload(video.id))
      }

      return { ok: true, video }
    },
    {
      body: t.Object({
        video: t.File(),
        thumbnail: t.Optional(t.File()),
        youtube_account_id: t.String(),
        title: t.String({ minLength: 1, maxLength: 200 }),
        description: t.Optional(t.String({ maxLength: 5000 })),
        tags: t.Optional(t.String()),
        category_id: t.Optional(t.String()),
        privacy: t.Optional(t.Union([t.Literal('public'), t.Literal('private'), t.Literal('unlisted')])),
        language: t.Optional(t.String()),
        made_for_kids: t.Optional(t.String()),
        scheduled_at: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    '/:id',
    async ({ params, body, user, set }) => {
      const id = Number(params.id)
      const existing = await db.query.videos.findFirst({
        where: and(eq(videos.id, id), eq(videos.userId, user.id)),
      })
      if (!existing) {
        set.status = 404
        return { error: 'Not found' }
      }

      const [updated] = await db.update(videos)
        .set({ ...body, updatedAt: new Date() } as Partial<typeof videos.$inferInsert>)
        .where(eq(videos.id, id))
        .returning()

      return { video: updated }
    },
    {
      body: t.Partial(t.Object({
        title: t.String({ minLength: 1, maxLength: 200 }),
        description: t.String({ maxLength: 5000 }),
        tags: t.String(),
        categoryId: t.String(),
        privacy: t.Union([t.Literal('public'), t.Literal('private'), t.Literal('unlisted')]),
        language: t.String(),
        madeForKids: t.Boolean(),
      })),
    }
  )
  .delete('/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const existing = await db.query.videos.findFirst({
      where: and(eq(videos.id, id), eq(videos.userId, user.id)),
    })
    if (!existing) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.delete(videos).where(eq(videos.id, id))
    return { ok: true }
  })
  .post('/:id/start', async ({ params, user, set }) => {
    const id = Number(params.id)
    const existing = await db.query.videos.findFirst({
      where: and(eq(videos.id, id), eq(videos.userId, user.id)),
    })
    if (!existing) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (existing.status === 'uploading' || existing.status === 'done') {
      set.status = 400
      return { error: `Status saat ini: ${existing.status}` }
    }
    queueMicrotask(() => runUpload(id))
    return { ok: true, message: 'Upload dimulai' }
  })

export const systemRoutes = new Elysia({ prefix: '/api/system' })
  .get('/worker-health', async () => {
    const ok = await workerHealth()
    return { worker: ok ? 'online' : 'offline' }
  })
