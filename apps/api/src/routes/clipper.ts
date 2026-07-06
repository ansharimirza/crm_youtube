// Clipper API: upload a source video + campaign requirements → AI-picked vertical clips.

import { Elysia, t } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { db, clipJobs, clips } from '../db'
import { authMiddleware } from '../middleware/auth'
import { processClipJob } from '../lib/clipper'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const SRC_DIR = join(UPLOAD_DIR, 'clipper', 'src')

export const clipperRoutes = new Elysia({ prefix: '/api/clipper' })
  .use(authMiddleware)
  // Create a job from an uploaded video + requirements; processing runs in the background.
  .post('/jobs', async ({ body, user, set }) => {
    try {
      const file = body.video
      await mkdir(SRC_DIR, { recursive: true })
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
      const path = join(SRC_DIR, `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`)
      await Bun.write(path, file)

      const count = Math.min(10, Math.max(1, Number(body.count) || 3))
      const aspectRatio = body.aspectRatio === '16:9' ? '16:9' : '9:16'
      const [job] = await db.insert(clipJobs).values({
        userId: user.id,
        title: (body.title?.trim() || file.name).slice(0, 200),
        sourceVideoPath: path,
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
      video: t.File(),
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
  // Delete a job (cascades clips).
  .delete('/jobs/:id', async ({ params, user }) => {
    await db.delete(clipJobs).where(and(eq(clipJobs.id, Number(params.id)), eq(clipJobs.userId, user.id)))
    return { ok: true }
  })
