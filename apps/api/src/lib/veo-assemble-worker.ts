// Faceless-video pipeline orchestration for Veo Studio projects:
//  - generateNarration(): TTS a scene's narration text -> wav + exact duration
//  - assembleProject(): ensure narration, download scene clips, run the ffmpeg
//    auto-edit, store the final MP4. Async with status on the project row.

import { eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { db, veoProjects, veoScenes, users } from '../db'
import { generateSpeechToFile, TTSError } from './tts'
import { assembleVideo, type AssembleScene } from './video-assembler'
import { notify } from './notifications'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const VEO_DIR = join(UPLOAD_DIR, 'veo')
const NARRATION_DIR = join(VEO_DIR, 'narration')
const CLIPS_DIR = join(VEO_DIR, 'clips')
const FINAL_DIR = join(VEO_DIR, 'final')

async function getGeminiKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  return user?.geminiApiKey || process.env.GEMINI_API_KEY || null
}

async function downloadToLocal(url: string, dir: string, prefix: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(dir, { recursive: true })
  const ext = extname(new URL(url).pathname) || '.mp4'
  const path = join(dir, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)
  await writeFile(path, buf)
  return path
}

// Generate TTS for one scene, store audio + duration. Returns the duration.
export async function generateNarration(sceneId: number, voice?: string): Promise<number> {
  const scene = await db.query.veoScenes.findFirst({
    where: eq(veoScenes.id, sceneId),
    with: { project: true },
  })
  if (!scene) throw new Error('Scene tidak ditemukan')
  if (!scene.narrationText.trim()) throw new Error('Scene belum punya teks narasi')

  const apiKey = await getGeminiKey(scene.project.userId)
  if (!apiKey) throw new TTSError('Gemini API key belum diatur (Settings → Gemini API Key)')

  await mkdir(NARRATION_DIR, { recursive: true })
  const outPath = join(NARRATION_DIR, `scene_${sceneId}_${Date.now()}.wav`)
  const { durationSec } = await generateSpeechToFile({
    apiKey,
    text: scene.narrationText,
    outPath,
    voice,
  })

  await db.update(veoScenes)
    .set({ narrationAudioPath: outPath, narrationDuration: durationSec, updatedAt: new Date() })
    .where(eq(veoScenes.id, sceneId))

  return durationSec
}

let assembling = new Set<number>()

// Assemble a whole project into one final video. Async — call & poll project.assembleStatus.
export async function assembleProject(projectId: number): Promise<void> {
  if (assembling.has(projectId)) return
  assembling.add(projectId)

  await db.update(veoProjects)
    .set({ assembleStatus: 'rendering', assembleError: null, updatedAt: new Date() })
    .where(eq(veoProjects.id, projectId))

  try {
    const project = await db.query.veoProjects.findFirst({
      where: eq(veoProjects.id, projectId),
      with: { scenes: { orderBy: (s, { asc }) => [asc(s.sceneNumber)] } },
    })
    if (!project) throw new Error('Project tidak ditemukan')

    // Eligible = video done + has narration text. Generate any missing TTS first.
    const eligible = project.scenes.filter((s) => s.status === 'done' && s.videoUrl && s.narrationText.trim())
    if (eligible.length === 0) {
      throw new Error('Tidak ada scene siap (butuh video done + teks narasi)')
    }

    const assembleScenes: AssembleScene[] = []
    for (const s of eligible) {
      // Narration audio (generate if missing)
      let audioPath = s.narrationAudioPath
      let dur = s.narrationDuration
      if (!audioPath || dur == null) {
        dur = await generateNarration(s.id)
        const fresh = await db.query.veoScenes.findFirst({ where: eq(veoScenes.id, s.id) })
        audioPath = fresh?.narrationAudioPath ?? null
      }
      if (!audioPath || dur == null) throw new Error(`Scene ${s.sceneNumber}: narasi gagal`)

      // Download the Veo clip locally for ffmpeg
      const videoPath = await downloadToLocal(s.videoUrl!, CLIPS_DIR, `scene${s.id}`)

      assembleScenes.push({
        videoPath,
        narrationPath: audioPath,
        narrationDur: dur,
        caption: s.narrationText,
      })
    }

    await mkdir(FINAL_DIR, { recursive: true })
    const outPath = join(FINAL_DIR, `project_${projectId}_${Date.now()}.mp4`)
    await assembleVideo(assembleScenes, outPath, { musicPath: project.musicPath ?? undefined })

    // Build a browser-openable link (token in URL — the JWT-gated route won't open in a browser).
    const owner = await db.query.users.findFirst({ where: eq(users.id, project.userId) })
    const base = process.env.PUBLIC_BASE_URL || 'https://crm.lovebell.app'
    const finalUrl = owner?.mcpApiKey
      ? `${base}/api/veo-pub/final/${projectId}?key=${owner.mcpApiKey}`
      : `/api/veo/projects/${projectId}/final-video`

    await db.update(veoProjects)
      .set({
        finalVideoPath: outPath,
        finalVideoUrl: finalUrl,
        assembleStatus: 'done',
        assembleError: null,
        updatedAt: new Date(),
      })
      .where(eq(veoProjects.id, projectId))

    await notify({
      userId: project.userId,
      type: 'veo_assembled',
      title: 'Video final selesai',
      message: `"${project.title}" sudah dirakit jadi 1 video, siap upload`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[assemble:${projectId}]`, msg)
    await db.update(veoProjects)
      .set({ assembleStatus: 'error', assembleError: msg, updatedAt: new Date() })
      .where(eq(veoProjects.id, projectId))
  } finally {
    assembling.delete(projectId)
  }
}

// On restart, reset any project stuck 'rendering' to error (the in-flight ffmpeg died).
export async function recoverStuckAssemblies() {
  const stuck = await db.query.veoProjects.findMany({ where: eq(veoProjects.assembleStatus, 'rendering') })
  for (const p of stuck) {
    await db.update(veoProjects)
      .set({ assembleStatus: 'error', assembleError: 'Render terputus saat restart — jalankan ulang', updatedAt: new Date() })
      .where(eq(veoProjects.id, p.id))
  }
  if (stuck.length) console.log(`[assemble] ${stuck.length} project 'rendering' nyangkut → error`)
}
