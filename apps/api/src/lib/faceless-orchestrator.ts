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
  narration_text?: string // optional when voiceMode='upload' (audio supplied per scene)
  video_prompt?: string // optional Veo motion prompt; defaults to image_prompt
}

// veo     = image animated by a Veo clip (cinematic, costs Veo credits)
// kenburns = still image + slow pan/zoom (no Veo)
// static  = still image, NO motion at all (held on screen for the narration)
export type FacelessMode = 'veo' | 'kenburns' | 'static'
// tts = Gemini TTS per scene; upload = user audio per scene; single = one full voiceover for the whole video
export type VoiceMode = 'tts' | 'upload' | 'single'

export async function createFacelessProject(
  userId: number,
  p: {
    title: string
    scenes: FacelessScene[]
    aspectRatio?: '16:9' | '9:16'
    model?: string
    mode?: FacelessMode
    voice?: string // Gemini TTS voice (e.g. Kore, Puck, Charon)
    voiceMode?: VoiceMode // 'tts' (default) or 'upload' (skip TTS, audio added per scene)
  },
): Promise<{ projectId: number; sceneIds: number[] }> {
  if (!p.scenes?.length) throw new Error('Minimal 1 scene')
  const mode: FacelessMode = p.mode ?? 'veo'
  const voiceMode: VoiceMode = p.voiceMode ?? 'tts'

  const [project] = await db.insert(veoProjects)
    .values({ userId, title: p.title, facelessMode: mode, facelessVoiceMode: voiceMode })
    .returning()
  const sceneIds: number[] = []

  const pending: { sceneId: number; imagePrompt: string }[] = []
  for (let i = 0; i < p.scenes.length; i++) {
    const s = p.scenes[i]
    const [scene] = await db.insert(veoScenes).values({
      projectId: project.id,
      sceneNumber: i + 1,
      prompt: s.video_prompt || s.image_prompt, // Veo motion prompt (unused for image modes)
      imagePrompt: s.image_prompt, // stored so failed scenes can be regenerated
      model: p.model ?? 'veo-3.1-fast',
      resolution: '1080p',
      duration: 8,
      aspectRatio: p.aspectRatio ?? '16:9',
      modeImage: 'frame',
      narrationText: s.narration_text ?? '',
      noZoom: mode === 'static',
      status: 'queued',
    }).returning()
    sceneIds.push(scene.id)
    pending.push({ sceneId: scene.id, imagePrompt: s.image_prompt })
  }

  // Throttled background generation — never fire all image+TTS at once (a 126-scene
  // project would otherwise slam GeminiGen/Gemini with 250+ concurrent calls).
  void runScenePool(userId, pending, mode, voiceMode, p.voice)

  return { projectId: project.id, sceneIds }
}

const SCENE_GEN_CONCURRENCY = 4
async function runScenePool(
  userId: number,
  pending: { sceneId: number; imagePrompt: string }[],
  mode: FacelessMode,
  voiceMode: VoiceMode,
  voice?: string,
): Promise<void> {
  let idx = 0
  const worker = async () => {
    while (idx < pending.length) {
      const { sceneId, imagePrompt } = pending[idx++]
      try {
        await generateSceneVisual(userId, sceneId, imagePrompt, mode)
      } catch (e) {
        // Mark the scene 'error' (not leave it silently 'queued') so it's visible + retryable.
        console.error('[faceless-visual]', e)
        const msg = e instanceof Error ? e.message : String(e)
        await db.update(veoScenes)
          .set({ status: 'error', errorMsg: msg.slice(0, 500), updatedAt: new Date() })
          .where(eq(veoScenes.id, sceneId)).catch(() => {})
        continue // visual failed → skip narration for this scene
      }
      // Upload-voice mode: audio is supplied per scene by the user, skip TTS.
      if (voiceMode === 'tts') {
        await generateNarration(sceneId, voice).catch((e) => console.error('[faceless-narr]', e))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCENE_GEN_CONCURRENCY, pending.length) }, worker))
}

// Resolve a project's faceless mode/voiceMode (stored on the row; fall back to
// inference for projects created before those columns existed).
function resolveFacelessMode(project: {
  facelessMode: string | null
  narrationFullPath: string | null
  scenes: { status: string; videoUrl: string | null; noZoom: boolean }[]
}): { mode: FacelessMode; voiceMode: VoiceMode } {
  let mode = project.facelessMode as FacelessMode | null
  if (!mode) {
    const done = project.scenes.find((s) => s.status === 'done')
    mode = done?.videoUrl ? 'veo' : done?.noZoom ? 'static' : 'kenburns'
  }
  const voiceMode: VoiceMode = project.narrationFullPath ? 'single' : 'tts'
  return { mode, voiceMode }
}

// A scene still needs (re)generation. Veo: missing a clip. Image modes: missing an
// image — this also catches scenes wrongly run through Veo (clip but no image).
function needsRegen(mode: FacelessMode, s: { status: string; videoUrl: string | null; firstImagePath: string | null }): boolean {
  if (s.status === 'error') return true
  if (mode === 'veo') return !s.videoUrl
  return !s.firstImagePath // static / kenburns
}

// Re-generate scenes that failed/stuck (transient GeminiGen errors during a big batch,
// or scenes accidentally sent through the wrong pipeline). Uses the stored mode.
export async function retryFailedScenes(userId: number, projectId: number): Promise<{ retried: number }> {
  const project = await db.query.veoProjects.findFirst({
    where: and(eq(veoProjects.id, projectId), eq(veoProjects.userId, userId)),
    with: { scenes: true },
  })
  if (!project) throw new Error('Project tidak ditemukan')

  const { mode, voiceMode } = resolveFacelessMode(project)
  const failed = project.scenes.filter((s) => needsRegen(mode, s))
  if (failed.length === 0) return { retried: 0 }

  // Reset to a clean queued state (drop any bogus clip), then re-run the pool.
  for (const s of failed) {
    await db.update(veoScenes)
      .set({ status: 'queued', errorMsg: null, progress: 0, videoUrl: null, geminigenUuid: null, updatedAt: new Date() })
      .where(eq(veoScenes.id, s.id))
  }
  const pending = failed.map((s) => ({ sceneId: s.id, imagePrompt: s.imagePrompt || s.prompt }))
  void runScenePool(userId, pending, mode, voiceMode)

  return { retried: failed.length }
}

// On startup: auto-heal faceless image-mode projects whose scenes are incomplete
// (e.g. a restart interrupted the gen pool). Re-runs image generation for them.
export async function recoverFacelessScenes(): Promise<void> {
  const projects = await db.query.veoProjects.findMany({
    where: (p, { inArray }) => inArray(p.facelessMode, ['static', 'kenburns']),
    with: { scenes: true },
  })
  let total = 0
  for (const project of projects) {
    const { mode, voiceMode } = resolveFacelessMode(project)
    const failed = project.scenes.filter((s) => needsRegen(mode, s))
    if (failed.length === 0) continue
    for (const s of failed) {
      await db.update(veoScenes)
        .set({ status: 'queued', errorMsg: null, progress: 0, videoUrl: null, geminigenUuid: null, updatedAt: new Date() })
        .where(eq(veoScenes.id, s.id))
    }
    const pending = failed.map((s) => ({ sceneId: s.id, imagePrompt: s.imagePrompt || s.prompt }))
    void runScenePool(project.userId, pending, mode, voiceMode)
    total += failed.length
  }
  if (total) console.log(`[faceless-recover] re-generating ${total} incomplete image scene(s)`)
}

// Keep the doodle STYLE but stop the model from rendering the art as a photo of a
// literal whiteboard object (frame, easel, wall). The drawing should fill the frame.
// (Intentional hand-lettered labels inside the art are fine — leaked section headers
// are already stripped at parse time, so we don't forbid in-art text here.)
function styleFixImagePrompt(p: string): string {
  const s = p
    .replace(/whiteboard[-\s]?doodle/gi, 'hand-drawn marker doodle')
    .replace(/\bon a whiteboard\b/gi, 'on a flat white background')
    .replace(/\bwhiteboard\b/gi, 'flat white background')
  return `${s} The artwork must fill the frame edge to edge as a flat 2D illustration on a plain solid background — do NOT depict a real whiteboard, easel, wall, picture frame, or photo border around the drawing.`
}

// Nano Banana image -> firstImagePath. veo mode: enqueue Veo (image->video).
// kenburns/static mode: the image IS the visual (assembler handles motion) -> mark done.
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

  const imageOnly = mode === 'kenburns' || mode === 'static'
  const { imageUrl } = await generateImageAndWait({
    apiKey,
    prompt: styleFixImagePrompt(imagePrompt),
    model: 'nano-banana-pro',
    aspectRatio: scene.aspectRatio as '16:9' | '9:16',
    resolution: imageOnly ? '2K' : undefined, // higher-res still for image-only modes
  })

  await mkdir(IMG_DIR, { recursive: true })
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
  const imgPath = join(IMG_DIR, `scene${sceneId}_${Date.now()}.jpg`)
  await writeFile(imgPath, Buffer.from(await res.arrayBuffer()))

  await db.update(veoScenes).set({ firstImagePath: imgPath, updatedAt: new Date() }).where(eq(veoScenes.id, sceneId))

  if (imageOnly) {
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
    categoryId?: string
    language?: string
    madeForKids?: boolean
    thumbnailPath?: string | null // uploaded thumbnail overrides the project's generated one
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
    categoryId: p.categoryId ?? '22',
    language: p.language ?? 'en',
    madeForKids: p.madeForKids ?? false,
    videoPath: project.finalVideoPath,
    thumbnailPath: p.thumbnailPath ?? project.thumbnailPath,
    fileName: `project_${p.projectId}.mp4`,
    status: scheduledAt ? 'scheduled' : 'queued',
    scheduledAt,
  }).returning()

  queueMicrotask(() => runUpload(video.id))
  return { videoId: video.id }
}
