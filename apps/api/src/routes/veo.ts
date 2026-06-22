import { Elysia, t } from 'elysia'
import { and, desc, eq, max } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { db, users, veoProjects, veoScenes } from '../db'
import { authMiddleware } from '../middleware/auth'
import { enqueueScene } from '../lib/scene-worker'
import {
  generateImageAndWait,
  GeminigenError,
  type ImageModel,
  type ImageAspectRatio,
  type ImageResolution,
} from '../lib/geminigen'
import { generateCaption, GeminiError, type Platform } from '../lib/gemini'
import { assembleProject, generateNarration } from '../lib/veo-assemble-worker'
import { createFacelessProject, uploadProjectFinal, type FacelessScene } from '../lib/faceless-orchestrator'

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

// Read an audio file's exact duration (seconds) via ffprobe — drives per-scene cut.
async function audioDurationSec(path: string): Promise<number> {
  const proc = Bun.spawn(
    ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const out = await new Response(proc.stdout).text()
  await proc.exited
  const d = parseFloat(out.trim())
  if (!isFinite(d) || d <= 0) throw new Error('Durasi audio tidak terbaca (format tidak didukung?)')
  return d
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

  // === FACELESS: one-call create (image + video/Ken Burns + TTS) from the web tab ===
  // Same engine the MCP create_project tool drives, but JWT-authed for the web app.
  .post('/faceless', async ({ body, user, set }) => {
    try {
      const { projectId, sceneIds } = await createFacelessProject(user.id, {
        title: body.title.trim(),
        scenes: body.scenes as FacelessScene[],
        aspectRatio: body.aspectRatio,
        mode: body.mode,
        voice: body.voice,
        voiceMode: body.voiceMode,
        model: body.model,
      })
      return { projectId, sceneIds, sceneCount: sceneIds.length }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal membuat project' }
    }
  }, {
    body: t.Object({
      title: t.String({ minLength: 1, maxLength: 200 }),
      scenes: t.Array(
        t.Object({
          image_prompt: t.String({ minLength: 1 }),
          narration_text: t.Optional(t.String()), // optional when voiceMode='upload'
          video_prompt: t.Optional(t.String()),
        }),
        { minItems: 1 },
      ),
      aspectRatio: t.Optional(t.Union([t.Literal('16:9'), t.Literal('9:16')])),
      mode: t.Optional(t.Union([t.Literal('veo'), t.Literal('kenburns'), t.Literal('static')])),
      voice: t.Optional(t.String()),
      voiceMode: t.Optional(t.Union([t.Literal('tts'), t.Literal('upload')])),
      model: t.Optional(t.String()),
    }),
  })

  // === FACELESS: upload the assembled final video to YouTube ===
  .post('/faceless/:id/upload', async ({ params, body, user, set }) => {
    try {
      const { videoId } = await uploadProjectFinal(user.id, {
        projectId: Number(params.id),
        youtubeAccountId: body.youtubeAccountId,
        title: body.title.trim(),
        description: body.description,
        tags: body.tags,
        privacy: body.privacy,
        scheduledAt: body.scheduledAt ?? null,
      })
      return { ok: true, videoId }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal upload' }
    }
  }, {
    body: t.Object({
      youtubeAccountId: t.Number(),
      title: t.String({ minLength: 1, maxLength: 200 }),
      description: t.Optional(t.String()),
      tags: t.Optional(t.String()),
      privacy: t.Optional(t.Union([t.Literal('public'), t.Literal('private'), t.Literal('unlisted')])),
      scheduledAt: t.Optional(t.String()),
    }),
  })

  .get('/projects/:id', async ({ params, user, set }) => {
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
  // Reorder scene di sebuah project
  .post('/projects/:id/scenes/reorder', async ({ params, body, user, set }) => {
    const projectId = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, projectId), eq(veoProjects.userId, user.id)),
      with: { scenes: true },
    })
    if (!project) {
      set.status = 404
      return { error: 'Project tidak ditemukan' }
    }

    // Tidak boleh reorder kalau ada scene yang lagi processing/queued
    const hasActive = project.scenes.some(s => s.status === 'processing' || s.status === 'queued')
    if (hasActive) {
      set.status = 400
      return { error: 'Tidak bisa reorder saat ada scene processing/queued' }
    }

    const ownIds = new Set(project.scenes.map(s => s.id))
    if (body.order.length !== project.scenes.length) {
      set.status = 400
      return { error: 'Order harus berisi semua scene' }
    }
    for (const id of body.order) {
      if (!ownIds.has(id)) {
        set.status = 400
        return { error: 'Scene ID tidak valid' }
      }
    }

    // Two-phase update: pertama set ke negative biar gak konflik, lalu set ke nomor baru
    for (const s of project.scenes) {
      await db.update(veoScenes).set({ sceneNumber: -s.id }).where(eq(veoScenes.id, s.id))
    }
    for (let i = 0; i < body.order.length; i++) {
      const id = body.order[i]
      await db.update(veoScenes)
        .set({ sceneNumber: i + 1, updatedAt: new Date() })
        .where(eq(veoScenes.id, id))
    }

    return { ok: true }
  }, {
    body: t.Object({ order: t.Array(t.Number()) }),
  })
  // Generate caption & metadata untuk publish
  .post('/projects/:id/generate-caption', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
      with: { scenes: { orderBy: [veoScenes.sceneNumber] } },
    })
    if (!project) {
      set.status = 404
      return { error: 'Project tidak ditemukan' }
    }

    const userRow = await db.query.users.findFirst({ where: eq(users.id, user.id) })
    const apiKey = userRow?.geminiApiKey ?? process.env.GEMINI_API_KEY
    if (!apiKey) {
      set.status = 400
      return { error: 'Gemini API key belum diatur di Settings' }
    }

    const scenePrompts = project.scenes.map(s => s.prompt).filter(Boolean)

    try {
      const result = await generateCaption({
        apiKey,
        platform: body.platform as Platform,
        projectTitle: project.title,
        projectDescription: project.description,
        scenePrompts,
        language: (body.language as 'id' | 'en') ?? 'id',
      })
      return { ok: true, result }
    } catch (err) {
      const msg = err instanceof GeminiError ? err.message : err instanceof Error ? err.message : String(err)
      console.error('[generate-caption] Error:', msg)
      set.status = 500
      return { ok: false, error: msg }
    }
  }, {
    body: t.Object({
      platform: t.Union([t.Literal('tiktok'), t.Literal('reels'), t.Literal('shorts')]),
      language: t.Optional(t.Union([t.Literal('id'), t.Literal('en')])),
    }),
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
    const referenceVideoPath = body.reference_video ? await saveFile(body.reference_video, 'ref-video') : null

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
      referenceVideoPath,
      narrationText: body.narration_text ?? '',
      status: 'queued',
    }).returning()

    // Trigger generation in background
    enqueueScene(scene.id)

    return { ok: true, scene }
  }, {
    body: t.Object({
      first_image: t.Optional(t.File()),
      last_image: t.Optional(t.File()),
      reference_video: t.Optional(t.File()),  // for Kling motion-control models
      prompt: t.String({ minLength: 1, maxLength: 4000 }),
      model: t.Union([
        t.Literal('veo-3.1'), t.Literal('veo-3.1-fast'), t.Literal('veo-3.1-lite'), t.Literal('veo-2'),
        t.Literal('grok-3'),
        t.Literal('kling-video-3-0'), t.Literal('kling-video-2-6'), t.Literal('kling-video-motion-3'),
      ]),
      resolution: t.Union([t.Literal('720p'), t.Literal('1080p')]),
      duration: t.String(),
      aspect_ratio: t.Union([t.Literal('16:9'), t.Literal('9:16')]),
      mode_image: t.Optional(t.Union([t.Literal('frame'), t.Literal('ingredient')])),
      narration_text: t.Optional(t.String({ maxLength: 5000 })),
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

    // Reset state, clear hasil lama (kalau ada)
    await db.update(veoScenes).set({
      status: 'queued',
      progress: 0,
      attempts: 0,
      errorMsg: null,
      geminigenUuid: null,
      geminigenId: null,
      videoUrl: null,
      thumbnailUrl: null,
      hasWatermark: 0,
      updatedAt: new Date(),
    }).where(eq(veoScenes.id, id))

    enqueueScene(id)
    return { ok: true }
  })
  // Edit scene metadata (multipart, optional images)
  .patch('/scenes/:id', async ({ params, body, user, set }) => {
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
      return { error: `Tidak bisa edit saat status: ${scene.status}` }
    }

    const updates: Partial<typeof veoScenes.$inferInsert> = { updatedAt: new Date() }
    if (body.prompt !== undefined) updates.prompt = body.prompt
    if (body.image_prompt !== undefined) updates.imagePrompt = body.image_prompt || null
    if (body.model) updates.model = body.model
    if (body.resolution) updates.resolution = body.resolution
    if (body.aspect_ratio) updates.aspectRatio = body.aspect_ratio
    if (body.duration) updates.duration = Number(body.duration)

    if (body.first_image) {
      updates.firstImagePath = await saveFile(body.first_image, 'first')
    }
    if (body.last_image) {
      updates.lastImagePath = await saveFile(body.last_image, 'last')
    }
    if (body.clear_first_image === 'true') updates.firstImagePath = null
    if (body.clear_last_image === 'true') updates.lastImagePath = null

    await db.update(veoScenes).set(updates).where(eq(veoScenes.id, id))

    // Jika regenerate flag true, reset state & enqueue
    if (body.regenerate === 'true') {
      await db.update(veoScenes).set({
        status: 'queued',
        progress: 0,
        attempts: 0,
        errorMsg: null,
        geminigenUuid: null,
        geminigenId: null,
        videoUrl: null,
        thumbnailUrl: null,
        hasWatermark: 0,
        updatedAt: new Date(),
      }).where(eq(veoScenes.id, id))
      enqueueScene(id)
    }

    const updated = await db.query.veoScenes.findFirst({ where: eq(veoScenes.id, id) })
    return { ok: true, scene: updated }
  }, {
    body: t.Object({
      prompt: t.Optional(t.String({ minLength: 1, maxLength: 4000 })),
      image_prompt: t.Optional(t.String({ maxLength: 4000 })),
      model: t.Optional(t.Union([
        t.Literal('veo-2'), t.Literal('veo-3.1'),
        t.Literal('veo-3.1-fast'), t.Literal('veo-3.1-lite'),
        t.Literal('grok-3'),
        t.Literal('kling-video-3-0'), t.Literal('kling-video-2-6'), t.Literal('kling-video-motion-3'),
      ])),
      resolution: t.Optional(t.Union([t.Literal('720p'), t.Literal('1080p')])),
      aspect_ratio: t.Optional(t.Union([t.Literal('16:9'), t.Literal('9:16')])),
      duration: t.Optional(t.String()),
      first_image: t.Optional(t.File()),
      last_image: t.Optional(t.File()),
      clear_first_image: t.Optional(t.String()),
      clear_last_image: t.Optional(t.String()),
      regenerate: t.Optional(t.String()),
    }),
  })
  // Generate image reference dari image_prompt scene (via GeminiGen image gen API)
  .post('/scenes/:id/generate-image', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.veoScenes.findFirst({
      where: eq(veoScenes.id, id),
      with: { project: true },
    })
    if (!scene || scene.project.userId !== user.id) {
      set.status = 404
      return { error: 'Scene tidak ditemukan' }
    }

    const prompt = body.prompt?.trim() || scene.imagePrompt
    if (!prompt) {
      set.status = 400
      return { error: 'Image prompt kosong. Edit scene dulu untuk isi image_prompt.' }
    }

    const userRow = await db.query.users.findFirst({ where: eq(users.id, user.id) })
    const apiKey = userRow?.geminigenApiKey ?? process.env.GEMINIGEN_API_KEY
    if (!apiKey) {
      set.status = 400
      return { error: 'GeminiGen API key belum diatur. Set di Settings.' }
    }

    const slot = body.slot ?? 'first'

    // Aspect ratio image: ikutin aspect ratio scene
    const imgAR: ImageAspectRatio =
      scene.aspectRatio === '9:16' ? '9:16'
      : scene.aspectRatio === '16:9' ? '16:9'
      : '1:1'

    try {
      const result = await generateImageAndWait({
        apiKey,
        prompt,
        model: (body.model ?? 'nano-banana-pro') as ImageModel,
        aspectRatio: imgAR,
        resolution: (body.resolution ?? '1K') as ImageResolution,
        style: body.style ?? 'Photorealistic',
        outputFormat: 'jpeg',
      })

      // Download image dan save ke disk
      const imgRes = await fetch(result.imageUrl)
      if (!imgRes.ok) throw new GeminigenError(`Download image gagal: HTTP ${imgRes.status}`)
      const buf = await imgRes.arrayBuffer()
      const filename = `${slot}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
      const filepath = join(VEO_DIR, filename)
      await Bun.write(filepath, buf)

      // Update scene
      const updateData: Partial<typeof veoScenes.$inferInsert> = { updatedAt: new Date() }
      if (slot === 'first') updateData.firstImagePath = filepath
      else updateData.lastImagePath = filepath

      await db.update(veoScenes).set(updateData).where(eq(veoScenes.id, id))

      return { ok: true, slot, imageUrl: result.imageUrl, geminigenUuid: result.uuid }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { ok: false, error: msg }
    }
  }, {
    body: t.Object({
      slot: t.Optional(t.Union([t.Literal('first'), t.Literal('last')])),
      prompt: t.Optional(t.String({ maxLength: 4000 })),
      model: t.Optional(t.Union([
        t.Literal('nano-banana-pro'),
        t.Literal('nano-banana-2'),
        t.Literal('imagen-4'),
      ])),
      resolution: t.Optional(t.Union([t.Literal('1K'), t.Literal('2K'), t.Literal('4K')])),
      style: t.Optional(t.String()),
    }),
  })
  // Serve image scene (untuk preview di UI)
  .get('/scenes/:id/image/:slot', async ({ params, user, set }) => {
    const id = Number(params.id)
    const slot = params.slot
    if (slot !== 'first' && slot !== 'last') {
      set.status = 400
      return { error: 'Invalid slot' }
    }
    const scene = await db.query.veoScenes.findFirst({
      where: eq(veoScenes.id, id),
      with: { project: true },
    })
    if (!scene || scene.project.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    const path = slot === 'first' ? scene.firstImagePath : scene.lastImagePath
    if (!path) {
      set.status = 404
      return { error: 'Image not set' }
    }
    return Bun.file(path)
  })
  // === FACELESS: set narration text + generate TTS for a scene ===
  .post('/scenes/:id/narration', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.veoScenes.findFirst({ where: eq(veoScenes.id, id), with: { project: true } })
    if (!scene || scene.project.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.update(veoScenes).set({ narrationText: body.narration_text, updatedAt: new Date() }).where(eq(veoScenes.id, id))
    try {
      const duration = await generateNarration(id, body.voice)
      return { ok: true, duration }
    } catch (err) {
      set.status = 500
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, {
    body: t.Object({
      narration_text: t.String({ minLength: 1, maxLength: 5000 }),
      voice: t.Optional(t.String()),
    }),
  })
  // === FACELESS: upload your own narration audio for a scene (voiceMode='upload') ===
  .post('/scenes/:id/narration-audio', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.veoScenes.findFirst({ where: eq(veoScenes.id, id), with: { project: true } })
    if (!scene || scene.project.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    const file = body.audio
    const dir = join(VEO_DIR, 'narration')
    await mkdir(dir, { recursive: true })
    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase()
    const path = join(dir, `scene_${id}_${Date.now()}.${ext}`)
    await Bun.write(path, file)
    let duration: number
    try {
      duration = await audioDurationSec(path)
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Durasi audio gagal dibaca' }
    }
    await db.update(veoScenes)
      .set({ narrationAudioPath: path, narrationDuration: duration, updatedAt: new Date() })
      .where(eq(veoScenes.id, id))
    return { ok: true, duration }
  }, {
    body: t.Object({ audio: t.File() }),
  })
  // === FACELESS: assemble whole project into 1 final video ===
  .post('/projects/:id/assemble', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
    })
    if (!project) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (project.assembleStatus === 'rendering') {
      set.status = 400
      return { error: 'Sedang dirakit, tunggu selesai' }
    }
    await db.update(veoProjects)
      .set({ assembleStatus: 'queued', assembleError: null, updatedAt: new Date() })
      .where(eq(veoProjects.id, id))
    const captions = !!(body as { captions?: boolean } | undefined)?.captions
    queueMicrotask(() => assembleProject(id, { captions }))
    return { ok: true }
  }, {
    body: t.Optional(t.Object({ captions: t.Optional(t.Boolean()) })),
  })
  // === FACELESS: serve the assembled final video ===
  .get('/projects/:id/final-video', async ({ params, user, set }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
    })
    if (!project || !project.finalVideoPath) {
      set.status = 404
      return { error: 'Belum ada video final' }
    }
    return Bun.file(project.finalVideoPath)
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
