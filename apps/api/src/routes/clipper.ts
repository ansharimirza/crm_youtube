// Clipper API: upload a source video + campaign requirements → AI-picked vertical clips.

import { Elysia, t } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { db, clipJobs, clips } from '../db'
import { authMiddleware } from '../middleware/auth'
import { processClipJob } from '../lib/clipper'
import { uploadLocalVideo } from './videos'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const SRC_DIR = join(UPLOAD_DIR, 'clipper', 'src')

export const clipperRoutes = new Elysia({ prefix: '/api/clipper' })
  .use(authMiddleware)
  // Create a job from an uploaded video + requirements; processing runs in the background.
  .post('/jobs', async ({ body, user, set }) => {
    try {
      const url = body.youtubeUrl?.trim()
      let sourceVideoPath: string | null = null
      let defaultTitle = url || 'Clip'
      if (body.video) {
        await mkdir(SRC_DIR, { recursive: true })
        const ext = (body.video.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
        sourceVideoPath = join(SRC_DIR, `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`)
        await Bun.write(sourceVideoPath, body.video)
        defaultTitle = body.video.name
      } else if (!url) {
        set.status = 400
        return { error: 'Butuh file video atau link YouTube' }
      }

      const count = Math.min(10, Math.max(1, Number(body.count) || 3))
      const aspectRatio = body.aspectRatio === '16:9' ? '16:9' : '9:16'
      const [job] = await db.insert(clipJobs).values({
        userId: user.id,
        title: (body.title?.trim() || defaultTitle).slice(0, 200),
        sourceVideoPath,
        sourceUrl: url || null,
        requirements: body.requirements ?? '',
        clipCount: count,
        aspectRatio,
        status: 'queued',
      }).returning()

      queueMicrotask(() => processClipJob(job.id))
      return { jobId: job.id }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal membuat job' }
    }
  }, {
    body: t.Object({
      video: t.Optional(t.File()),
      youtubeUrl: t.Optional(t.String()),
      requirements: t.Optional(t.String()),
      count: t.Optional(t.String()),
      aspectRatio: t.Optional(t.String()),
      title: t.Optional(t.String()),
    }),
  })
  // List the user's jobs (newest first) with clip counts.
  .get('/jobs', async ({ user }) => {
    const jobs = await db.query.clipJobs.findMany({
      where: eq(clipJobs.userId, user.id),
      orderBy: (j, { desc }) => [desc(j.createdAt)],
      with: { clips: true },
    })
    return {
      jobs: jobs.map((j) => ({
        id: j.id, title: j.title, status: j.status, error: j.error,
        clipCount: j.clipCount, aspectRatio: j.aspectRatio, createdAt: j.createdAt,
        clips: j.clips
          .sort((a, b) => a.startSec - b.startSec)
          .map((c) => ({ id: c.id, title: c.title, startSec: c.startSec, endSec: c.endSec, reason: c.reason, status: c.status, error: c.error })),
      })),
    }
  })
  // Serve a finished clip (ownership checked via its job).
  .get('/clips/:id/video', async ({ params, user, set }) => {
    const clip = await db.query.clips.findFirst({ where: eq(clips.id, Number(params.id)) })
    if (clip?.path) {
      const job = await db.query.clipJobs.findFirst({ where: and(eq(clipJobs.id, clip.jobId), eq(clipJobs.userId, user.id)) })
      if (job) return Bun.file(clip.path)
    }
    set.status = 404
    return { error: 'Clip belum siap' }
  })
  // Upload a finished clip to YouTube (via the US worker).
  .post('/clips/:id/upload', async ({ params, body, user, set }) => {
    try {
      const clip = await db.query.clips.findFirst({ where: eq(clips.id, Number(params.id)) })
      if (!clip?.path || clip.status !== 'done') { set.status = 404; return { error: 'Clip belum siap' } }
      const job = await db.query.clipJobs.findFirst({ where: and(eq(clipJobs.id, clip.jobId), eq(clipJobs.userId, user.id)) })
      if (!job) { set.status = 404; return { error: 'Clip tidak ditemukan' } }
      const title = body.title.trim().slice(0, 90)
      const { videoId } = await uploadLocalVideo(user.id, {
        filePath: clip.path,
        fileName: `clip_${clip.id}.mp4`,
        youtubeAccountId: body.youtubeAccountId,
        title: job.aspectRatio === '9:16' ? `${title} #Shorts` : title,
        description: body.description ?? '',
        privacy: body.privacy,
        scheduledAt: body.scheduledAt ?? null,
      })
      return { videoId }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal upload' }
    }
  }, {
    body: t.Object({
      youtubeAccountId: t.Number(),
      title: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      privacy: t.Optional(t.Union([t.Literal('public'), t.Literal('private'), t.Literal('unlisted')])),
      scheduledAt: t.Optional(t.Union([t.String(), t.Null()])),
    }),
  })
  // Delete a job (cascades clips).
  .delete('/jobs/:id', async ({ params, user }) => {
    await db.delete(clipJobs).where(and(eq(clipJobs.id, Number(params.id)), eq(clipJobs.userId, user.id)))
    return { ok: true }
  })
