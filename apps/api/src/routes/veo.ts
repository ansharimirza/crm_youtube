import { Elysia, t } from 'elysia'
import { and, desc, eq, max } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { db, users, veoProjects, veoScenes, veoShorts } from '../db'
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
import { assembleProject, generateNarration, alignProjectNarration } from '../lib/veo-assemble-worker'
import { generateProjectShort } from '../lib/shorts'
import { uploadLocalVideo } from './videos'
import { createFacelessProject, createFacelessFromUploads, uploadProjectFinal, retryFailedScenes, type FacelessScene } from '../lib/faceless-orchestrator'

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

// Parse a TikTok beat sheet: "BEAT n / [Segmen] "narasi" START:… END:… Motion: START+END → Veo 8s
// · … · Tag: START+END · … · Action: …". Every beat is a Veo clip; START+END uses 2 frames.
type TiktokBeat = { narration: string; clipDuration: number; action: string; tag: 'start_end' | 'single' }
function parseTiktokBeats(md: string): TiktokBeat[] {
  const raw = md.replace(/\r\n/g, '\n')
  const beats: TiktokBeat[] = []
  // KLIP storyboard format: "KLIP n (00:00–00:06) … COPY KE VEO ```…``` … VO ELEVENLABS: > "…"".
  // Every clip is START+END (IMAGE 1 + IMAGE 2). Narration = VO, action = the VEO prompt.
  if (/\bKLIP\s+\d+/i.test(raw) && /(VO\s*ELEVENLABS|IMAGE\s*1)/i.test(raw)) {
    for (const m of raw.matchAll(/\bKLIP\s+(\d+)\b([^\n]*)\n([\s\S]*?)(?=\bKLIP\s+\d+\b|$)/gi)) {
      const header = m[2]; const body = m[3]
      const narr = (body.match(/VO\s*ELEVENLABS[^\n]*:?[\s\S]*?["“]([^"”]+)["”]/i)?.[1]
        || body.match(/VO\s*ELEVENLABS[^\n]*:\s*\n?\s*>?\s*(.+)/i)?.[1] || '').trim()
      const action = (body.match(/COPY KE VEO[\s\S]*?```[a-z]*\n?([\s\S]*?)```/i)?.[1] || '').trim()
      const tr = header.match(/(\d+):(\d+)\s*[–\-—]\s*(\d+):(\d+)/)
      let dur = 6
      if (tr) dur = Math.max(1, (Number(tr[3]) * 60 + Number(tr[4])) - (Number(tr[1]) * 60 + Number(tr[2])))
      const clip = dur <= 4 ? 4 : dur <= 6 ? 6 : 8
      if (narr) beats.push({ narration: narr, clipDuration: clip, action, tag: 'start_end' })
    }
    if (beats.length) return beats
  }
  for (const m of raw.matchAll(/\bBEAT\s+(\d+)\b([\s\S]*?)(?=\bBEAT\s+\d+\b|$)/gi)) {
    const body = m[2]
    const narr = (body.match(/\[\s*segmen\s*\]\s*"([^"]+)"/i)
      || body.match(/\[\s*segmen\s*\]\s*(.+?)(?=\s+START:|\s+Motion:|\n)/i))?.[1] || ''
    const motionLine = (body.match(/Motion:\s*(.+)/i) || [])[1] || ''
    const clipDuration = Number((motionLine.match(/Veo\s*(\d+)\s*s/i) || [])[1]) || 8
    const tag: TiktokBeat['tag'] = /Tag:\s*START\s*\+\s*END/i.test(motionLine) || /\bSTART\s*\+\s*END\b/i.test(motionLine) ? 'start_end' : 'single'
    const action = (motionLine.match(/Action:\s*(.+?)\s*$/i) || [])[1] || ''
    // Only real narration beats (have a [Segmen] line). Lets the whole doc be pasted — the
    // image-prompt section (BEAT headers without [Segmen]) is ignored here.
    if (narr.trim()) beats.push({ narration: narr.trim(), clipDuration: [4, 6, 8].includes(clipDuration) ? clipDuration : 8, action: action.trim(), tag })
  }
  return beats
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
        imageProvider: body.imageProvider,
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
      voiceMode: t.Optional(t.Union([t.Literal('tts'), t.Literal('upload'), t.Literal('single')])),
      model: t.Optional(t.String()),
      imageProvider: t.Optional(t.Union([t.Literal('geminigen'), t.Literal('pollinations')])),
    }),
  })

  // === FACELESS: create a project from the user's OWN uploaded images (no gen, free) ===
  .post('/faceless-upload', async ({ body, user, set }) => {
    try {
      // Elysia may hand these back already parsed (array) or as a JSON string — accept both.
      const parseArr = <T,>(v: unknown): T[] | undefined =>
        v == null ? undefined : Array.isArray(v) ? (v as T[]) : (JSON.parse(String(v)) as T[])
      const narrations = parseArr<string>(body.narrations) ?? []
      const durations = parseArr<number>(body.durations)
      const videoPrompts = parseArr<string>(body.videoPrompts)
      const motions = parseArr<string>(body.motions)
      const clipDurations = parseArr<number>(body.clipDurations)
      const raw = Array.isArray(body.images) ? body.images : [body.images]
      // Stable order by filename (numeric-aware) so "01.png, 02.png, …" map correctly.
      const images = [...raw].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      const { projectId, sceneCount } = await createFacelessFromUploads(user.id, {
        title: body.title.trim(),
        narrations,
        durations,
        videoPrompts,
        motions,
        clipDurations,
        images,
        aspectRatio: body.aspectRatio as '16:9' | '9:16' | undefined,
        mode: body.mode as 'static' | 'kenburns' | undefined,
      })
      return { projectId, sceneCount }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal membuat project' }
    }
  }, {
    body: t.Object({
      title: t.String({ minLength: 1, maxLength: 200 }),
      // Accept anything (string JSON or Elysia-parsed array); the handler normalises both.
      // A Union here makes Elysia's multipart coercion mis-validate the whole body.
      narrations: t.Optional(t.Any()),
      durations: t.Optional(t.Any()),
      videoPrompts: t.Optional(t.Any()),
      motions: t.Optional(t.Any()),
      clipDurations: t.Optional(t.Any()),
      images: t.Files(),
      aspectRatio: t.Optional(t.String()),
      mode: t.Optional(t.String()),
    }),
  })

  // === RAKIT KLIP: several uploaded video clips + one narration → one assembled video ===
  // Clips play in order (natural length), narration overlaid, clip audio muted, total trimmed to
  // the narration duration (excess video cut). Free (ffmpeg), no Veo. Auto-assembles on create.
  .post('/assemble-clips', async ({ body, user, set }) => {
    try {
      const rawClips = Array.isArray(body.clips) ? body.clips : [body.clips]
      const clips = [...rawClips].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      if (clips.length === 0) { set.status = 400; return { error: 'Minimal 1 klip video' } }
      const [project] = await db.insert(veoProjects)
        .values({ userId: user.id, title: (body.title?.trim() || 'Rakit Klip').slice(0, 200), facelessMode: 'static', facelessVoiceMode: 'single' })
        .returning()
      // narration audio → project.narrationFullPath (+ duration via ffprobe)
      const nDir = join(VEO_DIR, 'narration')
      await mkdir(nDir, { recursive: true })
      const nExt = (body.narration.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3'
      const nPath = join(nDir, `project_${project.id}_full_${Date.now()}.${nExt}`)
      await Bun.write(nPath, body.narration)
      const nDur = await audioDurationSec(nPath)
      await db.update(veoProjects).set({ narrationFullPath: nPath, narrationFullDuration: nDur, updatedAt: new Date() }).where(eq(veoProjects.id, project.id))
      // each clip → a 'done' scene with videoUrl + its natural duration (alignedDuration)
      const vDir = join(VEO_DIR, 'clips')
      await mkdir(vDir, { recursive: true })
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i]
        const ext = (c.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
        const [scene] = await db.insert(veoScenes).values({
          projectId: project.id, sceneNumber: i + 1, prompt: `clip ${i + 1}`, imagePrompt: '',
          model: 'veo-3.1-fast', resolution: '1080p', duration: 8, aspectRatio: '16:9', modeImage: 'frame',
          status: 'done', progress: 100,
        }).returning()
        const vPath = join(vDir, `scene${scene.id}_clip_${Date.now()}.${ext}`)
        await Bun.write(vPath, c)
        const dur = await audioDurationSec(vPath) // ffprobe format=duration works for video too
        await db.update(veoScenes).set({ videoUrl: vPath, alignedDuration: dur, updatedAt: new Date() }).where(eq(veoScenes.id, scene.id))
      }
      await db.update(veoProjects).set({ assembleStatus: 'queued', assembleError: null, updatedAt: new Date() }).where(eq(veoProjects.id, project.id))
      queueMicrotask(() => assembleProject(project.id, {}))
      return { projectId: project.id, sceneCount: clips.length }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal merakit klip' }
    }
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      narration: t.File(),
      clips: t.Files(),
    }),
  })

  // === TIKTOK FACELESS: MD beat sheet + own images (named 1a/1b) + narration → 9:16 Veo project ===
  // Each beat = a Veo clip; START+END beats use 2 frames (Na=start, Nb=end), SINGLE uses 1 (Na).
  // Creates the scenes (motion=veo); user then Sync + "Generate semua Veo" + Rakit on the page.
  .post('/tiktok-upload', async ({ body, user, set }) => {
    try {
      const beats = parseTiktokBeats(String(body.md || ''))
      if (beats.length === 0) { set.status = 400; return { error: 'MD tidak terbaca (butuh "BEAT n / [Segmen] / Motion:")' } }
      // No renaming needed: sort by filename (numeric) and consume in order — 2 images per
      // START+END beat (first=start, second=end), 1 per SINGLE. Also accepts exactly one image
      // per beat (then every beat animates a single frame, no morphing).
      const rawImgs = Array.isArray(body.images) ? body.images : [body.images]
      const sortedImgs = [...rawImgs].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      const expectedSE = beats.reduce((n, b) => n + (b.tag === 'start_end' ? 2 : 1), 0)
      const beatImgs: { first: (typeof sortedImgs)[number]; last?: (typeof sortedImgs)[number] }[] = []
      if (sortedImgs.length === beats.length) {
        beats.forEach((_, i) => beatImgs.push({ first: sortedImgs[i] }))
      } else if (sortedImgs.length === beats.length * 2) {
        // 2 images per beat uniformly (even for SINGLE-tagged beats) — treat all as start+end morph.
        let idx = 0
        for (let i = 0; i < beats.length; i++) beatImgs.push({ first: sortedImgs[idx++], last: sortedImgs[idx++] })
      } else if (sortedImgs.length === expectedSE) {
        let idx = 0
        for (const b of beats) {
          const first = sortedImgs[idx++]
          const last = b.tag === 'start_end' ? sortedImgs[idx++] : undefined
          beatImgs.push({ first, last })
        }
      } else {
        set.status = 400
        return { error: `Jumlah gambar (${sortedImgs.length}) ga cocok. Butuh ${beats.length} (1/beat), ${beats.length * 2} (2/beat), ATAU ${expectedSE} (START+END per tag). Upload urut beat_01, beat_02, … (tiap beat: START dulu, END sesudahnya).` }
      }
      const [project] = await db.insert(veoProjects)
        .values({ userId: user.id, title: (body.title?.trim() || 'TikTok').slice(0, 200), facelessMode: 'static', facelessVoiceMode: 'single' })
        .returning()
      // narration is optional — if not given now, upload it later on the project page (like faceless).
      if (body.narration) {
        const nDir = join(VEO_DIR, 'narration')
        await mkdir(nDir, { recursive: true })
        const nExt = (body.narration.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3'
        const nPath = join(nDir, `project_${project.id}_full_${Date.now()}.${nExt}`)
        await Bun.write(nPath, body.narration)
        const nDur = await audioDurationSec(nPath)
        await db.update(veoProjects).set({ narrationFullPath: nPath, narrationFullDuration: nDur, updatedAt: new Date() }).where(eq(veoProjects.id, project.id))
      }
      // scenes (9:16, motion=veo, start/end frames)
      const iDir = join(VEO_DIR, 'images')
      await mkdir(iDir, { recursive: true })
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i]; const im = beatImgs[i]
        const [scene] = await db.insert(veoScenes).values({
          projectId: project.id, sceneNumber: i + 1, prompt: (b.action || b.narration || `beat ${i + 1}`).slice(0, 1500), imagePrompt: '',
          model: 'veo-3.1-fast', resolution: '1080p', duration: b.clipDuration, aspectRatio: '9:16', modeImage: 'frame',
          motion: 'veo', narrationText: b.narration, status: 'done', progress: 100,
        }).returning()
        const aExt = (im.first.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        const aPath = join(iDir, `scene${scene.id}_a_${Date.now()}.${aExt}`)
        await Bun.write(aPath, im.first)
        const upd: Partial<typeof veoScenes.$inferInsert> = { firstImagePath: aPath, updatedAt: new Date() }
        if (im.last) {
          const bExt = (im.last.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
          const bPath = join(iDir, `scene${scene.id}_b_${Date.now()}.${bExt}`)
          await Bun.write(bPath, im.last)
          upd.lastImagePath = bPath
        }
        await db.update(veoScenes).set(upd).where(eq(veoScenes.id, scene.id))
      }
      return { projectId: project.id, sceneCount: beats.length, veoCount: beats.length }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal membuat project TikTok' }
    }
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      md: t.String({ minLength: 1 }),
      narration: t.Optional(t.File()),
      images: t.Files(),
    }),
  })

  // === FACELESS: upload the assembled final video to YouTube (multipart: optional thumbnail) ===
  .post('/faceless/:id/upload', async ({ params, body, user, set }) => {
    try {
      const thumbPath = body.thumbnail ? await saveFile(body.thumbnail, 'veo_thumb') : undefined
      const { videoId } = await uploadProjectFinal(user.id, {
        projectId: Number(params.id),
        youtubeAccountId: Number(body.youtubeAccountId),
        title: body.title.trim(),
        description: body.description,
        tags: body.tags,
        privacy: body.privacy as 'public' | 'private' | 'unlisted' | undefined,
        categoryId: body.category_id,
        language: body.language,
        madeForKids: body.made_for_kids === 'true',
        scheduledAt: body.scheduled_at || null,
        thumbnailPath: thumbPath,
      })
      return { ok: true, videoId }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal upload' }
    }
  }, {
    body: t.Object({
      youtubeAccountId: t.String(),
      title: t.String({ minLength: 1, maxLength: 200 }),
      description: t.Optional(t.String()),
      tags: t.Optional(t.String()),
      privacy: t.Optional(t.String()),
      category_id: t.Optional(t.String()),
      language: t.Optional(t.String()),
      made_for_kids: t.Optional(t.String()),
      scheduled_at: t.Optional(t.String()),
      thumbnail: t.Optional(t.File()),
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
  // Set a scene's motion for assembly. Still motions (static/zoom/pan) are free & applied at
  // Rakit time. 'veo' animates the image into a clip (costs Veo credits) if not done yet.
  .post('/scenes/:id/motion', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.veoScenes.findFirst({ where: eq(veoScenes.id, id), with: { project: true } })
    if (!scene || scene.project.userId !== user.id) {
      set.status = 404
      return { error: 'Scene tidak ditemukan' }
    }
    const motion = body.motion
    // Switching a failed/stuck Veo scene to a still motion (pan/zoom/static) makes it usable as a
    // held image — mark it done so it counts toward Rakit again (a failed Veo left status='error').
    const revive = motion !== 'veo' && scene.status !== 'done' && !!scene.firstImagePath
    await db.update(veoScenes)
      .set({ motion, updatedAt: new Date(), ...(revive ? { status: 'done', progress: 100, errorMsg: null } : {}) })
      .where(eq(veoScenes.id, id))
    // Veo: generate the clip from the scene image if we don't already have one. The picker
    // sends the clip settings (duration/resolution/aspect/prompt) — save them onto the scene
    // so scene-worker's generateVeo() picks them up.
    if (motion === 'veo' && !scene.videoUrl) {
      const veoUpd: Partial<typeof veoScenes.$inferInsert> = { status: 'queued', progress: 0, attempts: 0, errorMsg: null, updatedAt: new Date() }
      if (body.duration) veoUpd.duration = body.duration
      if (body.resolution) veoUpd.resolution = body.resolution
      if (body.aspectRatio) veoUpd.aspectRatio = body.aspectRatio
      if (body.prompt !== undefined && body.prompt.trim()) veoUpd.prompt = body.prompt.trim().slice(0, 4000)
      await db.update(veoScenes).set(veoUpd).where(eq(veoScenes.id, id))
      enqueueScene(id)
      return { ok: true, generating: true }
    }
    return { ok: true, generating: false }
  }, {
    body: t.Object({
      motion: t.Union([t.Literal('static'), t.Literal('zoom'), t.Literal('pan_left'), t.Literal('pan_right'), t.Literal('veo')]),
      duration: t.Optional(t.Union([t.Literal(4), t.Literal(6), t.Literal(8)])),
      resolution: t.Optional(t.Union([t.Literal('720p'), t.Literal('1080p')])),
      aspectRatio: t.Optional(t.Union([t.Literal('16:9'), t.Literal('9:16')])),
      prompt: t.Optional(t.String({ maxLength: 4000 })),
    }),
  })
  // Batch-generate Veo clips for every scene marked motion='veo' that has an image but no clip yet.
  // Used after uploading images to a project whose motions were auto-assigned from a "Motion:" doc.
  .post('/projects/:id/generate-veo', async ({ params, user, set }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
      with: { scenes: true },
    })
    if (!project) { set.status = 404; return { error: 'Project tidak ditemukan' } }
    const targets = project.scenes.filter((s) => s.motion === 'veo' && !s.videoUrl && s.firstImagePath)
    for (const s of targets) {
      await db.update(veoScenes).set({ status: 'queued', progress: 0, attempts: 0, errorMsg: null, updatedAt: new Date() }).where(eq(veoScenes.id, s.id))
      enqueueScene(s.id)
    }
    return { queued: targets.length }
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
    if (body.clear_video === 'true') updates.videoUrl = null // revert to still image + motion

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
      clear_video: t.Optional(t.String()),
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
  // Upload the user's OWN video for a scene (replaces the still image). The assembler fits it
  // to the scene's aligned screen-time (freezes last frame if shorter, trims if longer).
  .post('/scenes/:id/video', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.veoScenes.findFirst({ where: eq(veoScenes.id, id), with: { project: true } })
    if (!scene || scene.project.userId !== user.id) {
      set.status = 404
      return { error: 'Scene tidak ditemukan' }
    }
    const file = body.video
    const dir = join(VEO_DIR, 'scene-videos')
    await mkdir(dir, { recursive: true })
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
    const path = join(dir, `scene_${id}_${Date.now()}.${ext}`)
    await Bun.write(path, file)
    // Store the LOCAL path in videoUrl; the assembler uses it directly (no download).
    await db.update(veoScenes).set({ videoUrl: path, status: 'done', progress: 100, updatedAt: new Date() }).where(eq(veoScenes.id, id))
    return { ok: true }
  }, {
    body: t.Object({ video: t.File() }),
  })
  // === FACELESS: retry scenes that failed/stuck (transient GeminiGen errors) ===
  .post('/projects/:id/retry-failed', async ({ params, user, set }) => {
    try {
      const { retried } = await retryFailedScenes(user.id, Number(params.id))
      return { ok: true, retried }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal retry' }
    }
  })
  // === FACELESS: upload ONE full narration for the whole project (voiceMode='single') ===
  .post('/projects/:id/narration-full', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
    })
    if (!project) {
      set.status = 404
      return { error: 'Not found' }
    }
    const file = body.audio
    const dir = join(VEO_DIR, 'narration')
    await mkdir(dir, { recursive: true })
    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase()
    const path = join(dir, `project_${id}_full_${Date.now()}.${ext}`)
    await Bun.write(path, file)
    let duration: number
    try {
      duration = await audioDurationSec(path)
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Durasi audio gagal dibaca' }
    }
    await db.update(veoProjects)
      .set({ narrationFullPath: path, narrationFullDuration: duration, updatedAt: new Date() })
      .where(eq(veoProjects.id, id))
    return { ok: true, duration }
  }, {
    body: t.Object({ audio: t.File() }),
  })
  // === FACELESS: forced-align the full narration to per-scene scripts (precise sync) ===
  .post('/projects/:id/align-narration', async ({ params, user, set }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({
      where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)),
    })
    if (!project) { set.status = 404; return { error: 'Not found' } }
    try {
      const { aligned } = await alignProjectNarration(id)
      return { ok: true, aligned }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal sync narasi' }
    }
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
  // === FACELESS SHORTS: auto-pick a hook segment + cut a 9:16 Short from the final video ===
  .post('/projects/:id/short', async ({ params, body, user, set }) => {
    try {
      const { id: shortId } = await generateProjectShort(user.id, Number(params.id), { captions: body?.captions !== false })
      return { id: shortId }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Gagal membuat Short' }
    }
  }, {
    body: t.Optional(t.Object({ captions: t.Optional(t.Boolean()) })),
  })
  .get('/projects/:id/shorts', async ({ params, user }) => {
    const id = Number(params.id)
    const project = await db.query.veoProjects.findFirst({ where: and(eq(veoProjects.id, id), eq(veoProjects.userId, user.id)) })
    if (!project) return { shorts: [] }
    const shorts = await db.query.veoShorts.findMany({
      where: eq(veoShorts.projectId, id),
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    })
    return { shorts: shorts.map((s) => ({ id: s.id, title: s.title, startSec: s.startSec, endSec: s.endSec, status: s.status, error: s.error, createdAt: s.createdAt })) }
  })
  .get('/shorts/:id/video', async ({ params, user, set }) => {
    const short = await db.query.veoShorts.findFirst({ where: eq(veoShorts.id, Number(params.id)) })
    if (short) {
      const project = await db.query.veoProjects.findFirst({ where: and(eq(veoProjects.id, short.projectId), eq(veoProjects.userId, user.id)) })
      if (project && short.path) return Bun.file(short.path)
    }
    set.status = 404
    return { error: 'Short belum siap' }
  })
  // Upload a finished Short to YouTube (via the US worker). YouTube auto-detects Shorts.
  .post('/shorts/:id/upload', async ({ params, body, user, set }) => {
    try {
      const short = await db.query.veoShorts.findFirst({ where: eq(veoShorts.id, Number(params.id)) })
      if (!short?.path || short.status !== 'done') { set.status = 404; return { error: 'Short belum siap' } }
      const project = await db.query.veoProjects.findFirst({ where: and(eq(veoProjects.id, short.projectId), eq(veoProjects.userId, user.id)) })
      if (!project) { set.status = 404; return { error: 'Short tidak ditemukan' } }
      const title = body.title.trim().slice(0, 90)
      const { videoId } = await uploadLocalVideo(user.id, {
        filePath: short.path,
        fileName: `short_${short.id}.mp4`,
        youtubeAccountId: body.youtubeAccountId,
        title: `${title} #Shorts`,
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
