import { Elysia, t } from 'elysia'
import { and, desc, eq, inArray, isNotNull, lt, or } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { db, videos, uploadLogs, youtubeAccounts } from '../db'
import { authMiddleware } from '../middleware/auth'
import {
  uploadViaWorker,
  updateMetadataViaWorker,
  getStatsViaWorker,
  workerHealth,
} from '../lib/worker'
import { notify } from '../lib/notifications'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
await mkdir(UPLOAD_DIR, { recursive: true })

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 30_000 // 30 detik

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

async function runUpload(videoId: number, isRetry = false) {
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
      .set({
        status: 'uploading',
        errorMsg: null,
        attempts: (video.attempts ?? 0) + 1,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId))

    const attemptNum = (video.attempts ?? 0) + 1
    await log(videoId, `Upload ${isRetry ? 'retry' : 'dimulai'} (attempt ${attemptNum}) ke channel: ${video.youtubeAccount.channelTitle ?? video.youtubeAccount.email}`)

    // Future scheduledAt -> upload now as private + publishAt; YouTube auto-publishes.
    const scheduledFuture = video.scheduledAt != null && new Date(video.scheduledAt).getTime() > Date.now()

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
      publishAt: scheduledFuture ? new Date(video.scheduledAt!).toISOString() : null,
      accessToken: video.youtubeAccount.accessToken,
      refreshToken: video.youtubeAccount.refreshToken,
    })

    if (result.ok) {
      await db.update(videos)
        .set({
          // Keep 'scheduled' badge while it waits on YouTube; otherwise it's live.
          status: scheduledFuture ? 'scheduled' : 'done',
          progress: 100,
          youtubeId: result.videoId,
          youtubeUrl: result.url,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(videos.id, videoId))
      await log(videoId, scheduledFuture
        ? `Upload selesai, dijadwalkan publish ${new Date(video.scheduledAt!).toLocaleString('id-ID')}: ${result.url}`
        : `Upload selesai: ${result.url}`)

      // Notifikasi sukses
      await notify({
        userId: video.userId,
        videoId: video.id,
        type: 'upload_done',
        title: scheduledFuture ? 'Video terjadwal di YouTube' : 'Upload selesai',
        message: scheduledFuture
          ? `"${video.title}" sudah di YouTube (private) & akan publish otomatis sesuai jadwal`
          : `"${video.title}" berhasil diupload ke YouTube`,
      })
    } else {
      throw new Error(result.error)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const currentAttempts = (video.attempts ?? 0) + 1
    const shouldRetry = currentAttempts < MAX_RETRIES

    await db.update(videos)
      .set({
        status: 'error',
        errorMsg: msg,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId))
    await log(videoId, `Error (attempt ${currentAttempts}/${MAX_RETRIES}): ${msg}`, 'error')

    if (shouldRetry) {
      await log(videoId, `Auto-retry dalam ${RETRY_DELAY_MS / 1000}s...`)
      setTimeout(() => runUpload(videoId, true), RETRY_DELAY_MS)
    } else {
      await notify({
        userId: video.userId,
        videoId: video.id,
        type: 'upload_failed',
        title: 'Upload gagal',
        message: `"${video.title}" gagal diupload setelah ${MAX_RETRIES}x percobaan: ${msg}`,
      })
    }
  }
}

// Background job: refresh stats untuk video done
async function refreshStatsForVideo(videoId: number) {
  const video = await db.query.videos.findFirst({
    where: eq(videos.id, videoId),
    with: { youtubeAccount: true },
  })
  if (!video || !video.youtubeId || !video.youtubeAccount) return

  const result = await getStatsViaWorker({
    videoIds: [video.youtubeId],
    accessToken: video.youtubeAccount.accessToken,
    refreshToken: video.youtubeAccount.refreshToken,
  })

  if (!result.ok) return
  const stat = result.stats[0]
  if (!stat) return

  await db.update(videos).set({
    viewCount: stat.viewCount,
    likeCount: stat.likeCount,
    commentCount: stat.commentCount,
    statsUpdatedAt: new Date(),
  }).where(eq(videos.id, videoId))
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

      // Always upload now. If scheduled in the future, runUpload sends it to
      // YouTube as private with publishAt so YouTube auto-publishes on time.
      queueMicrotask(() => runUpload(video.id))

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
  // Bulk upload — banyak video sekaligus
  .post(
    '/bulk',
    async ({ body, user, set }) => {
      const ytAccountId = Number(body.youtube_account_id)
      const ytAccount = await db.query.youtubeAccounts.findFirst({
        where: and(eq(youtubeAccounts.id, ytAccountId), eq(youtubeAccounts.userId, user.id)),
      })
      if (!ytAccount) {
        set.status = 400
        return { error: 'YouTube account tidak valid' }
      }

      const filesField = body.videos
      const files = Array.isArray(filesField) ? filesField : [filesField]
      if (files.length === 0) {
        set.status = 400
        return { error: 'Minimal 1 file video' }
      }

      const created: number[] = []
      for (const file of files) {
        if (!(file instanceof File)) continue
        const videoPath = await saveFile(file, 'video')
        const baseName = file.name.replace(/\.[^.]+$/, '')

        const [video] = await db.insert(videos).values({
          userId: user.id,
          youtubeAccountId: ytAccount.id,
          title: baseName.slice(0, 100),
          description: body.description ?? '',
          tags: (body.tags ?? '').split(',').map(t => t.trim()).filter(Boolean).join(','),
          categoryId: body.category_id ?? '22',
          privacy: (body.privacy ?? 'private') as 'public' | 'private' | 'unlisted',
          language: body.language ?? 'en',
          madeForKids: false,
          videoPath,
          fileName: file.name,
          fileSize: file.size,
          status: 'queued',
        }).returning()

        created.push(video.id)
      }

      // Queue upload satu per satu (sequential biar tidak overwhelm worker)
      ;(async () => {
        for (const id of created) {
          await runUpload(id)
        }
      })()

      return { ok: true, count: created.length, videoIds: created }
    },
    {
      body: t.Object({
        videos: t.Union([t.File(), t.Array(t.File())]),
        youtube_account_id: t.String(),
        description: t.Optional(t.String()),
        tags: t.Optional(t.String()),
        category_id: t.Optional(t.String()),
        privacy: t.Optional(t.Union([t.Literal('public'), t.Literal('private'), t.Literal('unlisted')])),
        language: t.Optional(t.String()),
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
  // Push edited metadata ke YouTube (untuk video yang sudah ada di YouTube)
  .post('/:id/push-metadata', async ({ params, user, set }) => {
    const id = Number(params.id)
    const video = await db.query.videos.findFirst({
      where: and(eq(videos.id, id), eq(videos.userId, user.id)),
      with: { youtubeAccount: true },
    })
    if (!video) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (!video.youtubeId || !video.youtubeAccount) {
      set.status = 400
      return { error: 'Video belum diupload ke YouTube' }
    }

    const result = await updateMetadataViaWorker({
      videoId: video.youtubeId,
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

    if (!result.ok) {
      set.status = 500
      return { error: result.error }
    }

    await log(id, 'Metadata di-push ke YouTube')
    return { ok: true }
  })
  // Refresh stats untuk 1 video
  .post('/:id/refresh-stats', async ({ params, user, set }) => {
    const id = Number(params.id)
    const video = await db.query.videos.findFirst({
      where: and(eq(videos.id, id), eq(videos.userId, user.id)),
    })
    if (!video) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (!video.youtubeId) {
      set.status = 400
      return { error: 'Video belum diupload ke YouTube' }
    }

    await refreshStatsForVideo(id)
    const updated = await db.query.videos.findFirst({ where: eq(videos.id, id) })
    return { ok: true, video: updated }
  })
  // Refresh stats batch untuk semua video user yang sudah di-upload
  .post('/refresh-all-stats', async ({ user }) => {
    const list = await db.query.videos.findMany({
      where: and(
        eq(videos.userId, user.id),
        eq(videos.status, 'done'),
        isNotNull(videos.youtubeId),
      ),
      with: { youtubeAccount: true },
    })

    // Group by youtubeAccountId untuk batch panggilan API
    const byAccount = new Map<number, typeof list>()
    for (const v of list) {
      if (!v.youtubeAccountId) continue
      const arr = byAccount.get(v.youtubeAccountId) ?? []
      arr.push(v)
      byAccount.set(v.youtubeAccountId, arr)
    }

    let totalUpdated = 0
    for (const [, vids] of byAccount) {
      const acc = vids[0].youtubeAccount
      if (!acc) continue
      const ids = vids.map(v => v.youtubeId!).filter(Boolean)
      const result = await getStatsViaWorker({
        videoIds: ids,
        accessToken: acc.accessToken,
        refreshToken: acc.refreshToken,
      })
      if (!result.ok) continue
      for (const stat of result.stats) {
        const matching = vids.find(v => v.youtubeId === stat.videoId)
        if (!matching) continue
        await db.update(videos).set({
          viewCount: stat.viewCount,
          likeCount: stat.likeCount,
          commentCount: stat.commentCount,
          statsUpdatedAt: new Date(),
        }).where(eq(videos.id, matching.id))
        totalUpdated++
      }
    }

    return { ok: true, updated: totalUpdated }
  })
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

    // Reset attempts kalau manual retry
    await db.update(videos).set({ attempts: 0 }).where(eq(videos.id, id))
    queueMicrotask(() => runUpload(id))
    return { ok: true, message: 'Upload dimulai' }
  })

export const systemRoutes = new Elysia({ prefix: '/api/system' })
  .get('/worker-health', async () => {
    const ok = await workerHealth()
    return { worker: ok ? 'online' : 'offline' }
  })
