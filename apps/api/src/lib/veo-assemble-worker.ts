// Faceless-video pipeline orchestration for Veo Studio projects:
//  - generateNarration(): TTS a scene's narration text -> wav + exact duration
//  - assembleProject(): ensure narration, download scene clips, run the ffmpeg
//    auto-edit, store the final MP4. Async with status on the project row.

import { eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { db, veoProjects, veoScenes, users } from '../db'
import { generateSpeechToFile, TTSError } from './tts'
import { generateSpeechGCloudToFile } from './tts-gcloud'
import { assembleVideo, type AssembleScene, type SceneMotion } from './video-assembler'

// Only still-image motions apply to an image scene ('veo' needs a generated clip).
const STILL_MOTIONS = ['static', 'zoom', 'pan_left', 'pan_right']
const stillMotion = (m: string | null): SceneMotion | undefined =>
  m && STILL_MOTIONS.includes(m) ? (m as SceneMotion) : undefined
import { transcribeWords } from './transcribe'
import { alignBeats } from './align'
import { notify } from './notifications'

// Gemini (preview) TTS voice names. Anything else → Google Cloud TTS (free 1M chars/mo).
const GEMINI_VOICES = new Set(['Kore', 'Puck', 'Charon', 'Aoede', 'Leda', 'Fenrir', 'Orus', 'Zephyr'])
const isGeminiVoice = (v?: string | null): boolean => !!v && GEMINI_VOICES.has(v)

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
  // Uploaded scene video: videoUrl is already a local file path — use it directly.
  if (!/^https?:\/\//i.test(url)) {
    if (await Bun.file(url).exists()) return url
    throw new Error(`Video scene tidak ditemukan: ${url}`)
  }
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
  if (!apiKey) throw new TTSError('Google API key belum diatur (Settings → Gemini API Key)')

  await mkdir(NARRATION_DIR, { recursive: true })

  // Default: Google Cloud TTS (free 1M chars/mo, reliable). Gemini preview TTS only if a
  // Gemini voice (Kore/Charon/…) is explicitly chosen.
  let outPath: string
  let durationSec: number
  if (isGeminiVoice(voice)) {
    outPath = join(NARRATION_DIR, `scene_${sceneId}_${Date.now()}.wav`)
    ;({ durationSec } = await generateSpeechToFile({ apiKey, text: scene.narrationText, outPath, voice }))
  } else {
    outPath = join(NARRATION_DIR, `scene_${sceneId}_${Date.now()}.mp3`)
    ;({ durationSec } = await generateSpeechGCloudToFile({ apiKey, text: scene.narrationText, outPath, voice: voice ?? undefined }))
  }

  await db.update(veoScenes)
    .set({ narrationAudioPath: outPath, narrationDuration: durationSec, updatedAt: new Date() })
    .where(eq(veoScenes.id, sceneId))

  return durationSec
}

let assembling = new Set<number>()

// Assemble a whole project into one final video. Async — call & poll project.assembleStatus.
// opts.captions: burn the narration as subtitles (default OFF).
export async function assembleProject(projectId: number, opts: { captions?: boolean } = {}): Promise<void> {
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

    const fullNarration = project.narrationFullPath && project.narrationFullDuration
      ? { path: project.narrationFullPath, dur: project.narrationFullDuration }
      : null

    const assembleScenes: AssembleScene[] = []

    if (fullNarration) {
      // ONE voiceover for the whole video. Screen time per scene comes from forced
      // alignment (alignedDuration, precise) when available; otherwise it falls back to
      // weighting by narration-text length (rough). Equal split if no text.
      const eligible = project.scenes.filter((s) => s.status === 'done' && (s.videoUrl || s.firstImagePath))
      if (eligible.length === 0) throw new Error('Tidak ada scene siap (butuh visual done)')

      const useAligned = eligible.every((s) => (s.alignedDuration ?? 0) > 0)
      const weights = eligible.map((s) => Math.max(1, s.narrationText.trim().length))
      const totalW = weights.reduce((a, b) => a + b, 0)
      for (let i = 0; i < eligible.length; i++) {
        const s = eligible[i]
        const dur = useAligned
          ? Math.max(0.5, s.alignedDuration!)
          : Math.max(0.5, (fullNarration.dur * weights[i]) / totalW)
        const caption = opts.captions ? s.narrationText : undefined
        if (s.videoUrl) {
          const videoPath = await downloadToLocal(s.videoUrl, CLIPS_DIR, `scene${s.id}`)
          assembleScenes.push({ videoPath, narrationDur: dur, caption }) // silent segment
        } else if (s.firstImagePath) {
          assembleScenes.push({ imagePath: s.firstImagePath, noZoom: s.noZoom, motion: stillMotion(s.motion), narrationDur: dur, caption })
        }
      }
    } else {
      // Per-scene narration (TTS or per-scene uploaded audio).
      // Eligible = visual done + has narration (text for TTS, OR an uploaded audio file).
      const eligible = project.scenes.filter(
        (s) => s.status === 'done' && (s.videoUrl || s.firstImagePath) && (s.narrationText.trim() || s.narrationAudioPath),
      )
      if (eligible.length === 0) {
        throw new Error('Tidak ada scene siap (butuh visual done + narasi/suara)')
      }

      for (const s of eligible) {
        // Narration audio (generate via TTS if missing)
        let audioPath = s.narrationAudioPath
        let dur = s.narrationDuration
        if (!audioPath || dur == null) {
          dur = await generateNarration(s.id)
          const fresh = await db.query.veoScenes.findFirst({ where: eq(veoScenes.id, s.id) })
          audioPath = fresh?.narrationAudioPath ?? null
        }
        if (!audioPath || dur == null) throw new Error(`Scene ${s.sceneNumber}: narasi gagal`)

        const caption = opts.captions ? s.narrationText : undefined
        if (s.videoUrl) {
          const videoPath = await downloadToLocal(s.videoUrl, CLIPS_DIR, `scene${s.id}`)
          assembleScenes.push({ videoPath, narrationPath: audioPath, narrationDur: dur, caption })
        } else if (s.firstImagePath) {
          assembleScenes.push({ imagePath: s.firstImagePath, noZoom: s.noZoom, motion: stillMotion(s.motion), narrationPath: audioPath, narrationDur: dur, caption })
        } else {
          throw new Error(`Scene ${s.sceneNumber}: tidak ada visual (klip/gambar)`)
        }
      }
    }

    await mkdir(FINAL_DIR, { recursive: true })
    const outPath = join(FINAL_DIR, `project_${projectId}_${Date.now()}.mp4`)
    const portrait = (project.scenes[0]?.aspectRatio ?? '16:9') === '9:16'
    await assembleVideo(assembleScenes, outPath, {
      musicPath: project.musicPath ?? undefined,
      fullNarrationPath: fullNarration?.path ?? undefined,
      width: portrait ? 1080 : 1920,
      height: portrait ? 1920 : 1080,
    })

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

// Forced-align the uploaded full narration to the per-scene scripts, storing the exact
// screen-time (alignedDuration) for each scene so images line up with what's spoken.
export async function alignProjectNarration(projectId: number): Promise<{ aligned: number }> {
  const project = await db.query.veoProjects.findFirst({
    where: eq(veoProjects.id, projectId),
    with: { scenes: { orderBy: (s, { asc }) => [asc(s.sceneNumber)] } },
  })
  if (!project) throw new Error('Project tidak ditemukan')
  if (!project.narrationFullPath || !project.narrationFullDuration) {
    throw new Error('Belum ada narasi penuh — upload audio dulu')
  }
  // Same eligibility + order as full-narration assembly, so durations line up 1:1.
  const eligible = project.scenes.filter((s) => s.status === 'done' && (s.videoUrl || s.firstImagePath))
  if (eligible.length === 0) throw new Error('Tidak ada scene siap (butuh visual done)')

  const words = await transcribeWords(project.narrationFullPath)
  // Strip script tags like "[Segmen]"/"[Beat 3]" — they aren't spoken, so leaving them in
  // breaks anchor matching (every beat's first word becomes "segmen") and the sync drifts.
  const durations = alignBeats(
    eligible.map((s) => ({ text: (s.narrationText || '').replace(/\[[^\]]*\]/g, ' ') })),
    words,
    project.narrationFullDuration,
  )
  for (let i = 0; i < eligible.length; i++) {
    await db.update(veoScenes)
      .set({ alignedDuration: durations[i], updatedAt: new Date() })
      .where(eq(veoScenes.id, eligible[i].id))
  }
  return { aligned: eligible.length }
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
