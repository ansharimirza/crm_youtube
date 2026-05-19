// Scene generation worker
// - Concurrency limit (max 5 simultaneous Geminigen calls)
// - Auto-retry on failure until success (capped attempts to prevent runaway)
// - Polls history endpoint until terminal status

import { eq } from 'drizzle-orm'
import { db, veoScenes, users } from '../db'
import { generateVeo, getHistory, isTerminalStatus, GeminigenError, type VeoModel, type VeoResolution, type VeoAspectRatio, type VeoModeImage } from './geminigen'
import { notify } from './notifications'

const MAX_CONCURRENT = 5
const MAX_ATTEMPTS = 20            // hard cap supaya tidak runaway
const POLL_INTERVAL_MS = 10_000    // 10s polling
const POLL_TIMEOUT_MS = 30 * 60_000 // 30 menit max wait per attempt
const RETRY_DELAY_MS = 15_000      // 15s sebelum coba lagi setelah fail

let activeJobs = 0
const queue: number[] = []

function tryStartNext() {
  while (activeJobs < MAX_CONCURRENT && queue.length > 0) {
    const sceneId = queue.shift()!
    activeJobs++
    runScene(sceneId)
      .catch(err => console.error(`[scene-worker:${sceneId}]`, err))
      .finally(() => {
        activeJobs--
        tryStartNext()
      })
  }
}

export function enqueueScene(sceneId: number) {
  if (!queue.includes(sceneId)) queue.push(sceneId)
  tryStartNext()
}

async function getApiKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (!user) return null
  if (user.geminigenApiKey) return user.geminigenApiKey
  // fallback ke env (untuk dev / single-tenant)
  return process.env.GEMINIGEN_API_KEY ?? null
}

async function pollUntilDone(uuid: string, apiKey: string, sceneId: number) {
  const start = Date.now()
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const history = await getHistory(uuid, apiKey)

    // Update progress di DB
    await db.update(veoScenes)
      .set({ progress: history.status_percentage ?? 0, updatedAt: new Date() })
      .where(eq(veoScenes.id, sceneId))

    if (isTerminalStatus(history.status)) return history
  }
  throw new GeminigenError('Polling timeout')
}

async function runScene(sceneId: number) {
  const scene = await db.query.veoScenes.findFirst({
    where: eq(veoScenes.id, sceneId),
    with: { project: true },
  })
  if (!scene) return

  const apiKey = await getApiKey(scene.project.userId)
  if (!apiKey) {
    await db.update(veoScenes).set({
      status: 'error',
      errorMsg: 'GeminiGen API key belum diatur. Set di Settings.',
      updatedAt: new Date(),
    }).where(eq(veoScenes.id, sceneId))
    return
  }

  let attempts = scene.attempts ?? 0
  let lastError = ''

  while (attempts < MAX_ATTEMPTS) {
    attempts++

    try {
      await db.update(veoScenes).set({
        status: 'processing',
        attempts,
        progress: 0,
        errorMsg: null,
        updatedAt: new Date(),
      }).where(eq(veoScenes.id, sceneId))

      console.log(`[scene-worker:${sceneId}] Attempt ${attempts}/${MAX_ATTEMPTS}`)

      const generated = await generateVeo({
        apiKey,
        prompt: scene.prompt,
        model: scene.model as VeoModel,
        resolution: scene.resolution as VeoResolution,
        duration: scene.duration,
        aspectRatio: scene.aspectRatio as VeoAspectRatio,
        modeImage: scene.modeImage as VeoModeImage,
        firstImagePath: scene.firstImagePath,
        lastImagePath: scene.lastImagePath,
      })

      await db.update(veoScenes).set({
        geminigenUuid: generated.uuid,
        geminigenId: generated.id,
        updatedAt: new Date(),
      }).where(eq(veoScenes.id, sceneId))

      const history = await pollUntilDone(generated.uuid, apiKey, sceneId)

      if (history.status === 2) {
        // Sukses
        const video = history.generated_video?.[0]
        await db.update(veoScenes).set({
          status: 'done',
          progress: 100,
          videoUrl: video?.video_url ?? null,
          thumbnailUrl: history.thumbnail_urls?.[0] ?? null,
          hasWatermark: video?.has_watermark ?? 0,
          errorMsg: null,
          updatedAt: new Date(),
        }).where(eq(veoScenes.id, sceneId))

        await notify({
          userId: scene.project.userId,
          type: 'veo_done',
          title: `Scene ${scene.sceneNumber} selesai`,
          message: `"${scene.project.title}" Scene ${scene.sceneNumber} berhasil generate`,
        })

        console.log(`[scene-worker:${sceneId}] DONE`)
        return
      }

      // status === 3 (failed) → retry
      lastError = history.error_message || history.status_desc || 'Generation failed'
      console.warn(`[scene-worker:${sceneId}] Fail attempt ${attempts}: ${lastError}`)

    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[scene-worker:${sceneId}] Error attempt ${attempts}: ${lastError}`)
    }

    // Update error msg & retry setelah delay
    await db.update(veoScenes).set({
      errorMsg: `Attempt ${attempts}: ${lastError}. Retrying...`,
      updatedAt: new Date(),
    }).where(eq(veoScenes.id, sceneId))

    if (attempts < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
  }

  // Setelah MAX_ATTEMPTS gagal semua
  await db.update(veoScenes).set({
    status: 'error',
    errorMsg: `Gagal setelah ${MAX_ATTEMPTS}x percobaan. Last error: ${lastError}`,
    updatedAt: new Date(),
  }).where(eq(veoScenes.id, sceneId))

  await notify({
    userId: scene.project.userId,
    type: 'veo_failed',
    title: `Scene ${scene.sceneNumber} gagal`,
    message: `"${scene.project.title}" Scene ${scene.sceneNumber} gagal setelah ${MAX_ATTEMPTS}x. ${lastError}`,
  })
}

// On startup: requeue scene yang masih queued/processing (recovery dari crash)
export async function recoverPendingScenes() {
  const pending = await db.query.veoScenes.findMany({
    where: (s, { or, eq }) => or(eq(s.status, 'queued'), eq(s.status, 'processing')),
  })
  for (const s of pending) {
    console.log(`[scene-worker] Recovering scene ${s.id} (status: ${s.status})`)
    enqueueScene(s.id)
  }
}
