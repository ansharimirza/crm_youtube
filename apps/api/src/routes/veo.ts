import { Elysia, t } from 'elysia'
import { and, desc, eq, max } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { db, veoProjects, veoScenes } from '../db'
import { authMiddleware } from '../middleware/auth'
import { enqueueScene } from '../lib/scene-worker'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const VEO_DIR = join(UPLOAD_DIR, 'veo')
await mkdir(VEO_DIR, { recursive: true })

async function saveFile(file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const filepath = join(VEO_DIR, filename)
  await Bun.write(filepath, file)
  return filepath
}

export const veoRoutes = new Elysia({ prefix: '/api/veo' })
  .use(authMiddleware)

  // === PROJECTS ===
  .get('/projects', async ({ user }) => {
    const list = await db.query.veoProjects.findMany({
      where: eq(veoProjects.userId, user.id),
      orderBy: [desc(veoProjects.createdAt)],
      with: {
        scenes: {
          columns: { id: true, status: true, videoUrl: true, thumbnailUrl: true },
        },
      },
    })

    const projects = list.map(p => {
      const sceneCount = p.scenes.length
      const doneCount = p.scenes.filter(s => s.status === 'done').length
      const errorCount = p.scenes.filter(s => s.status === 'error').length
      const processingCount = p.scenes.filter(s => s.status === 'processing' || s.status === 'queued').length
      const thumbnail = p.scenes.find(s => s.thumbnailUrl)?.thumbnailUrl ?? null
      return {
        id: p.id, title: p.title, description: p.description,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
        sceneCount, doneCount, errorCount, processingCount,
        thumbnail,
      }
    })

    return { projects }
  })
  .post('/projects', async ({ body, user }) => {
    const [project] = await db.insert(veoProjects).values({
      userId: user.id,
      title: body.title.trim(),
      description: body.description?.trim() ?? '',
    }).returning()
    return { project }
  }, {
    body: t.Object({
      title: t.String({ minLength: 1, maxLength: 200 }),
      description: t.Optional(t.String({ maxLength: 1000 })),
    }),
  })
  .get('/projects/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
      with: {
        scenes: { orderBy: [desc(veoScenes.sceneNumber)] },
      },
    })
    if (!project) {
      set.status = 404
      return { error: 'Project tidak ditemukan' }
    }
    return { project }
  })
  .patch('/projects/:id', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const existing = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
    })
    if (!existing) {
      set.status = 404
      return { error: 'Project tidak ditemukan' }
    }
    const [updated] = await db.update(veoProjects).set({
      ...(body.title ? { title: body.title.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() } : {}),
      updatedAt: new Date(),
    }).where(eq(veoProjects.id, id)).returning()
    return { project: updated }
  }, {
    body: t.Partial(t.Object({
      title: t.String({ minLength: 1, maxLength: 200 }),
      description: t.String({ maxLength: 1000 }),
    })),
  })
  // Download semua scene done jadi 1 ZIP
  .get('/projects/:id/download-all', async ({ params, user, set }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
      with: {
        scenes: { orderBy: [veoScenes.sceneNumber] },
      },
    })
    if (!project) {
      set.status = 404
      return { error: 'Project tidak ditemukan' }
    }

    const doneScenes = project.scenes.filter(s => s.status === 'done' && s.videoUrl)
    if (doneScenes.length === 0) {
      set.status = 400
      return { error: 'Belum ada scene yang selesai untuk di-download' }
    }

    const zip = new JSZip()
    let added = 0
    const failed: number[] = []

    // Download videos paralel (max 5 sekaligus)
    const BATCH = 5
    for (let i = 0; i < doneScenes.length; i += BATCH) {
      const batch = doneScenes.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        batch.map(async (scene) => {
          const res = await fetch(scene.videoUrl!)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = await res.arrayBuffer()
          return { scene, buf }
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { scene, buf } = r.value
          const filename = `scene-${String(scene.sceneNumber).padStart(2, '0')}.mp4`
          zip.file(filename, buf)
          added++
        } else {
          // Reject reason not exposed individually here; track count
        }
      }
    }

    if (added === 0) {
      set.status = 500
      return { error: 'Gagal download semua video' }
    }

    const safeTitle = project.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'veo-project'
    const zipBuf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } })

    set.headers['Content-Type'] = 'application/zip'
    set.headers['Content-Disposition'] = `attachment; filename="${safeTitle}.zip"`
    set.headers['Content-Length'] = String(zipBuf.byteLength)
    return new Response(zipBuf)
  })
  .delete('/projects/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const existing = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
    })
    if (!existing) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.delete(veoProjects).where(eq(veoProjects.id, id))
    return { ok: true }
  })

  // === SCENES ===
  .post('/projects/:id/scenes', async ({ params, body, user, set }) => {
    const projectId = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, projectId), eq(veoProjects.userId, user.id)),
    })
    if (!project) {
      set.status = 404
      return { error: 'Project tidak ditemukan' }
    }

    // Next scene number
    const [maxRow] = await db.select({ max: max(veoScenes.sceneNumber) })
      .from(veoScenes).where(eq(veoScenes.projectId, projectId))
    const nextSceneNumber = (maxRow.max ?? 0) + 1

    const firstImagePath = body.first_image ? await saveFile(body.first_image, 'first') : null
    const lastImagePath = body.last_image ? await saveFile(body.last_image, 'last') : null

    const [scene] = await db.insert(veoScenes).values({
      projectId,
      sceneNumber: nextSceneNumber,
      prompt: body.prompt,
      model: body.model,
      resolution: body.resolution,
      duration: Number(body.duration),
      aspectRatio: body.aspect_ratio,
      modeImage: body.mode_image ?? 'frame',
      firstImagePath,
      lastImagePath,
      status: 'queued',
    }).returning()

    // Trigger generation in background
    enqueueScene(scene.id)

    return { ok: true, scene }
  }, {
    body: t.Object({
      first_image: t.Optional(t.File()),
      last_image: t.Optional(t.File()),
      prompt: t.String({ minLength: 1, maxLength: 4000 }),
      model: t.Union([t.Literal('veo-3.1'), t.Literal('veo-3.1-fast'), t.Literal('veo-3.1-lite'), t.Literal('veo-2')]),
      resolution: t.Union([t.Literal('720p'), t.Literal('1080p')]),
      duration: t.String(),
      aspect_ratio: t.Union([t.Literal('16:9'), t.Literal('9:16')]),
      mode_image: t.Optional(t.Union([t.Literal('frame'), t.Literal('ingredient')])),
    }),
  })
  .post('/scenes/:id/retry', async ({ params, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.veoScenes.findFirst({
      where: eq(veoScenes.id, id),
      with: { project: true },
    })
    if (!scene || scene.project.userId !== user.id) {
      set.status = 404
      return { error: 'Scene tidak ditemukan' }
    }
    if (scene.status === 'processing' || scene.status === 'queued') {
      set.status = 400
      return { error: `Sedang ${scene.status}, tidak perlu retry` }
    }

    // Reset state
    await db.update(veoScenes).set({
      status: 'queued',
      progress: 0,
      attempts: 0,
      errorMsg: null,
      geminigenUuid: null,
      geminigenId: null,
      updatedAt: new Date(),
    }).where(eq(veoScenes.id, id))

    enqueueScene(id)
    return { ok: true }
  })
  .delete('/scenes/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.veoScenes.findFirst({
      where: eq(veoScenes.id, id),
      with: { project: true },
    })
    if (!scene || scene.project.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.delete(veoScenes).where(eq(veoScenes.id, id))
    return { ok: true }
  })
