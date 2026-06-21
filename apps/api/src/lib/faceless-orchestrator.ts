// One-call orchestration for the faceless-video flow (used by MCP tools):
//  - createFacelessProject(): create project + scenes, then per scene generate
//    Nano Banana image -> Veo (image->video) + TTS narration (all async).
//  - uploadProjectFinal(): push the assembled final video to YouTube.

import { and, eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { db, users, veoProjects, veoScenes, videos, youtubeAccounts } from '../db'
import { generateImageAndWait } from './geminigen'
import { enqueueScene } from './scene-worker'
import { generateNarration } from './veo-assemble-worker'
import { runUpload } from '../routes/videos'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const IMG_DIR = join(UPLOAD_DIR, 'veo', 'images')

async function geminigenKey(userId: number): Promise<string | null> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) })
  return u?.geminigenApiKey || process.env.GEMINIGEN_API_KEY || null
}

export interface FacelessScene {
  image_prompt: string
  narration_text: string
  video_prompt?: string // optional Veo motion prompt; defaults to image_prompt
}

export type FacelessMode = 'veo' | 'kenburns'

export async function createFacelessProject(
  userId: number,
  p: {
    title: string
    scenes: FacelessScene[]
    aspectRatio?: '16:9' | '9:16'
    model?: string
    mode?: FacelessMode // 'veo' (image->Veo clip) or 'kenburns' (still image + pan/zoom)
    voice?: string // Gemini TTS voice (e.g. Kore, Puck, Charon)
  },
): Promise<{ projectId: number; sceneIds: number[] }> {
  if (!p.scenes?.length) throw new Error('Minimal 1 scene')
  const mode: FacelessMode = p.mode ?? 'veo'

  const [project] = await db.insert(veoProjects).values({ userId, title: p.title }).returning()
  const sceneIds: number[] = []

  const pending: { sceneId: number; imagePrompt: string }[] = []
  for (let i = 0; i < p.scenes.length; i++) {
    const s = p.scenes[i]
    const [scene] = await db.insert(veoScenes).values({
      projectId: project.id,
      sceneNumber: i + 1,
      prompt: s.video_prompt || s.image_prompt, // Veo motion prompt (unused in kenburns)
      model: p.model ?? 'veo-3.1-fast',
      resolution: '1080p',
      duration: 8,
      aspectRatio: p.aspectRatio ?? '16:9',
      modeImage: 'frame',
      narrationText: s.narration_text,
      status: 'queued',
    }).returning()
    sceneIds.push(scene.id)
    pending.push({ sceneId: scene.id, imagePrompt: s.image_prompt })
  }

  // Throttled background generation — never fire all image+TTS at once (a 126-scene
  // project would otherwise slam GeminiGen/Gemini with 250+ concurrent calls).
  void runScenePool(userId, pending, mode, p.voice)

  return { projectId: project.id, sceneIds }
}

const SCENE_GEN_CONCURRENCY = 4
async function runScenePool(
  userId: number,
  pending: { sceneId: number; imagePrompt: string }[],
  mode: FacelessMode,
  voice?: string,
): Promise<void> {
  let idx = 0
  const worker = async () => {
    while (idx < pending.length) {
      const { sceneId, imagePrompt } = pending[idx++]
      await generateSceneVisual(userId, sceneId, imagePrompt, mode).catch((e) => console.error('[faceless-visual]', e))
      await generateNarration(sceneId, voice).catch((e) => console.error('[faceless-narr]', e))
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCENE_GEN_CONCURRENCY, pending.length) }, worker))
}

// Nano Banana image -> firstImagePath. veo mode: enqueue Veo (image->video).
// kenburns mode: the image IS the visual (assembler pans/zooms it) -> mark done.
async function generateSceneVisual(userId: number, sceneId: number, imagePrompt: string, mode: FacelessMode): Promise<void> {
  const apiKey = await geminigenKey(userId)
  if (!apiKey) {
    await db.update(veoScenes)
      .set({ status: 'error', errorMsg: 'GeminiGen API key belum diatur (Settings)', updatedAt: new Date() })
      .where(eq(veoScenes.id, sceneId))
    return
  }
  const scene = await db.query.veoScenes.findFirst({ where: eq(veoScenes.id, sceneId) })
  if (!scene) return

  const { imageUrl } = await generateImageAndWait({
    apiKey,
    prompt: imagePrompt,
    model: 'nano-banana-pro',
    aspectRatio: scene.aspectRatio as '16:9' | '9:16',
    resolution: mode === 'kenburns' ? '2K' : undefined, // higher-res image for Ken Burns zoom
  })

  await mkdir(IMG_DIR, { recursive: true })
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
  const imgPath = join(IMG_DIR, `scene${sceneId}_${Date.now()}.jpg`)
  await writeFile(imgPath, Buffer.from(await res.arrayBuffer()))

  await db.update(veoScenes).set({ firstImagePath: imgPath, updatedAt: new Date() }).where(eq(veoScenes.id, sceneId))

  if (mode === 'kenburns') {
    await db.update(veoScenes).set({ status: 'done', progress: 100, updatedAt: new Date() }).where(eq(veoScenes.id, sceneId))
  } else {
    enqueueScene(sceneId) // Veo animates the image
  }
}

// Generate a thumbnail (Nano Banana) for the project; stored + attached on upload.
export async function generateThumbnail(userId: number, projectId: number, imagePrompt: string): Promise<{ path: string }> {
  const project = await db.query.veoProjects.findFirst({
    where: and(eq(veoProjects.id, projectId), eq(veoProjects.userId, userId)),
  })
  if (!project) throw new Error('Project tidak ditemukan')
  const apiKey = await geminigenKey(userId)
  if (!apiKey) throw new Error('GeminiGen API key belum diatur (Settings)')

  const { imageUrl } = await generateImageAndWait({ apiKey, prompt: imagePrompt, model: 'nano-banana-pro', aspectRatio: '16:9' })
  const THUMB_DIR = join(UPLOAD_DIR, 'veo', 'thumbnails')
  await mkdir(THUMB_DIR, { recursive: true })
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`Thumbnail download failed: HTTP ${res.status}`)
  const path = join(THUMB_DIR, `project${projectId}_${Date.now()}.jpg`)
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  await db.update(veoProjects).set({ thumbnailPath: path, updatedAt: new Date() }).where(eq(veoProjects.id, projectId))
  return { path }
}

export async function uploadProjectFinal(
  userId: number,
  p: {
    projectId: number
    youtubeAccountId: number
    title: string
    description?: string
    tags?: string
    privacy?: 'public' | 'private' | 'unlisted'
    scheduledAt?: string | null
  },
): Promise<{ videoId: number }> {
  const project = await db.query.veoProjects.findFirst({
    where: and(eq(veoProjects.id, p.projectId), eq(veoProjects.userId, userId)),
  })
  if (!project?.finalVideoPath) throw new Error('Video final belum dirakit — jalankan assemble dulu')

  const acc = await db.query.youtubeAccounts.findFirst({
    where: and(eq(youtubeAccounts.id, p.youtubeAccountId), eq(youtubeAccounts.userId, userId)),
  })
  if (!acc) throw new Error('Akun YouTube tidak valid')

  const scheduledAt = p.scheduledAt ? new Date(p.scheduledAt) : null
  const [video] = await db.insert(videos).values({
    userId,
    youtubeAccountId: acc.id,
    title: p.title,
    description: p.description ?? '',
    tags: p.tags ?? '',
    privacy: p.privacy ?? 'public',
    language: 'en',
    madeForKids: false,
    videoPath: project.finalVideoPath,
    thumbnailPath: project.thumbnailPath,
    fileName: `project_${p.projectId}.mp4`,
    status: scheduledAt ? 'scheduled' : 'queued',
    scheduledAt,
  }).returning()

  queueMicrotask(() => runUpload(video.id))
  return { videoId: video.id }
}
