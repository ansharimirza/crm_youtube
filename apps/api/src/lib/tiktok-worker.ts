// TikTok Studio worker — orchestrates Veo generation for campaign scenes.
// Similar to scene-worker.ts but for tiktok_scenes table.

import { eq, and } from 'drizzle-orm'
import { db, tiktokScenes, tiktokCampaigns, users } from '../db'
import {
  generateVeo, getHistory, isTerminalStatus, GeminigenError,
  type VeoModel, type VeoResolution, type VeoAspectRatio,
} from './geminigen'
import { notify } from './notifications'

const MAX_CONCURRENT = 5
const MAX_ATTEMPTS = 10
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 30 * 60_000
const RETRY_DELAY_MS = 15_000

let activeJobs = 0
const queue: number[] = []

function tryStartNext() {
  while (activeJobs < MAX_CONCURRENT && queue.length > 0) {
    const sceneId = queue.shift()!
    activeJobs++
    runScene(sceneId)
      .catch((err) => console.error(`[tiktok-worker:${sceneId}]`, err))
      .finally(() => {
        activeJobs--
        tryStartNext()
      })
  }
}

export function enqueueTiktokScene(sceneId: number) {
  if (!queue.includes(sceneId)) queue.push(sceneId)
  tryStartNext()
}

async function getApiKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user?.geminigenApiKey) return user.geminigenApiKey
  return process.env.GEMINIGEN_API_KEY ?? null
}

async function pollUntilDone(uuid: string, apiKey: string, sceneId: number) {
  const start = Date.now()
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const history = await getHistory(uuid, apiKey)
    await db.update(tiktokScenes)
      .set({ progress: history.status_percentage ?? 0, updatedAt: new Date() })
      .where(eq(tiktokScenes.id, sceneId))
    if (isTerminalStatus(history.status)) return history
  }
  throw new GeminigenError('Polling timeout')
}

async function runScene(sceneId: number) {
  const scene = await db.query.tiktokScenes.findFirst({
    where: eq(tiktokScenes.id, sceneId),
    with: { campaign: true },
  })
  if (!scene) return
  const campaign = scene.campaign

  const apiKey = await getApiKey(campaign.userId)
  if (!apiKey) {
    await db.update(tiktokScenes).set({
      status: 'error',
      errorMsg: 'GeminiGen API key belum diatur. Set di Settings.',
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, sceneId))
    return
  }

  // For tiktok scenes, the product image is used as `first_image` reference
  // so Veo generates videos consistent with the actual product
  const firstImagePath = campaign.productImagePath ?? null

  let attempts = scene.attempts ?? 0
  let lastError = ''

  while (attempts < MAX_ATTEMPTS) {
    attempts++

    try {
      await db.update(tiktokScenes).set({
        status: 'processing',
        attempts,
        progress: 0,
        errorMsg: null,
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, sceneId))

      console.log(`[tiktok-worker:${sceneId}] Attempt ${attempts}/${MAX_ATTEMPTS}`)

      const generated = await generateVeo({
        apiKey,
        prompt: scene.veoPrompt,
        model: campaign.veoModel as VeoModel,
        resolution: campaign.resolution as VeoResolution,
        duration: scene.duration,
        aspectRatio: campaign.aspectRatio as VeoAspectRatio,
        modeImage: 'frame',
        firstImagePath,
        lastImagePath: null,
      })

      await db.update(tiktokScenes).set({
        geminigenUuid: generated.uuid,
        geminigenId: generated.id,
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, sceneId))

      const history = await pollUntilDone(generated.uuid, apiKey, sceneId)

      if (history.status === 2) {
        const video = history.generated_video?.[0]
        await db.update(tiktokScenes).set({
          status: 'done',
          progress: 100,
          videoUrl: video?.video_url ?? null,
          thumbnailUrl: history.thumbnail_urls?.[0] ?? null,
          errorMsg: null,
          updatedAt: new Date(),
        }).where(eq(tiktokScenes.id, sceneId))

        await maybeMarkCampaignDone(campaign.id, campaign.userId)
        console.log(`[tiktok-worker:${sceneId}] DONE`)
        return
      }

      lastError = history.error_message || history.status_desc || 'Generation failed'
      console.warn(`[tiktok-worker:${sceneId}] Fail attempt ${attempts}: ${lastError}`)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[tiktok-worker:${sceneId}] Error attempt ${attempts}: ${lastError}`)
    }

    await db.update(tiktokScenes).set({
      errorMsg: `Attempt ${attempts}: ${lastError}. Retrying...`,
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, sceneId))

    if (attempts < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }

  await db.update(tiktokScenes).set({
    status: 'error',
    errorMsg: `Gagal setelah ${MAX_ATTEMPTS}x. Last: ${lastError}`,
    updatedAt: new Date(),
  }).where(eq(tiktokScenes.id, sceneId))

  await notify({
    userId: campaign.userId,
    type: 'tiktok_scene_failed',
    title: `TikTok scene ${scene.sceneNumber} gagal`,
    message: `"${campaign.title}" Scene ${scene.sceneNumber} gagal: ${lastError}`,
  })
}

async function maybeMarkCampaignDone(campaignId: number, userId: number) {
  const allScenes = await db.query.tiktokScenes.findMany({
    where: eq(tiktokScenes.campaignId, campaignId),
  })
  const allDone = allScenes.every((s) => s.status === 'done')
  if (allDone && allScenes.length > 0) {
    await db.update(tiktokCampaigns)
      .set({ status: 'done', updatedAt: new Date() })
      .where(eq(tiktokCampaigns.id, campaignId))
    const campaign = await db.query.tiktokCampaigns.findFirst({ where: eq(tiktokCampaigns.id, campaignId) })
    if (campaign) {
      await notify({
        userId,
        type: 'tiktok_campaign_done',
        title: `TikTok campaign selesai`,
        message: `"${campaign.title}" — semua ${allScenes.length} scene berhasil generate`,
      })
    }
  }
}

export async function recoverPendingTiktokScenes() {
  const pending = await db.query.tiktokScenes.findMany({
    where: (s, { or, eq }) => or(eq(s.status, 'queued'), eq(s.status, 'processing')),
  })
  for (const s of pending) {
    console.log(`[tiktok-worker] Recovering scene ${s.id} (status: ${s.status})`)
    enqueueTiktokScene(s.id)
  }
}
