// TikTok Studio worker — two-phase orchestration:
// Phase 1 (image): Nano Banana generates a still frame per scene using
//   character + product reference images. Runs automatically after campaign create.
// Phase 2 (video): Veo animates the still frame into a 4-8s clip when the user
//   clicks "Generate Video".

import { eq } from 'drizzle-orm'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { db, tiktokScenes, tiktokCampaigns, users } from '../db'
import {
  generateVeo, generateGrok, mapVeoAspectToGrok,
  getHistory, isTerminalStatus, GeminigenError,
  generateImage, getImageHistory,
  type VeoModel, type VeoResolution, type VeoAspectRatio,
  type GrokDuration, type GrokResolution,
  type ImageAspectRatio,
} from './geminigen'
import { notify } from './notifications'

const MAX_CONCURRENT_IMG = 4
const MAX_CONCURRENT_VID = 5
const MAX_ATTEMPTS = 8
const RETRY_DELAY_MS = 12_000

// Validation errors are deterministic — retrying 8x won't help. Stop early.
function isPermanentValidationError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('must be between') ||
    m.includes('invalid value') ||
    m.includes('validation failed') ||
    m.includes('not allowed') ||
    m.includes('unsupported') ||
    m.includes('invalid prompt') ||
    m.includes('content policy') ||
    m.includes('400 bad request')
  )
}

// Video polling
const VID_POLL_INTERVAL_MS = 10_000
const VID_POLL_TIMEOUT_MS = 30 * 60_000

// Image polling
const IMG_POLL_INTERVAL_MS = 3_000
const IMG_POLL_TIMEOUT_MS = 5 * 60_000

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

// =========== queues ===========
let imgActive = 0
let vidActive = 0
const imgQueue: number[] = []
const vidQueue: number[] = []

function pumpImg() {
  while (imgActive < MAX_CONCURRENT_IMG && imgQueue.length > 0) {
    const id = imgQueue.shift()!
    imgActive++
    runSceneImage(id)
      .catch((err) => console.error(`[tiktok-img:${id}]`, err))
      .finally(() => { imgActive--; pumpImg() })
  }
}

function pumpVid() {
  while (vidActive < MAX_CONCURRENT_VID && vidQueue.length > 0) {
    const id = vidQueue.shift()!
    vidActive++
    runSceneVideo(id)
      .catch((err) => console.error(`[tiktok-vid:${id}]`, err))
      .finally(() => { vidActive--; pumpVid() })
  }
}

export function enqueueTiktokImage(sceneId: number) {
  if (!imgQueue.includes(sceneId)) imgQueue.push(sceneId)
  pumpImg()
}

export function enqueueTiktokVideo(sceneId: number) {
  if (!vidQueue.includes(sceneId)) vidQueue.push(sceneId)
  pumpVid()
}

async function getApiKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user?.geminigenApiKey) return user.geminigenApiKey
  return process.env.GEMINIGEN_API_KEY ?? null
}

// Helper: download a URL and save to local uploads dir, return local path
async function downloadToLocal(url: string, subdir: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = extname(new URL(url).pathname) || '.jpg'
  const dir = join(UPLOADS_DIR, subdir)
  await mkdir(dir, { recursive: true })
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
  const fullPath = join(dir, filename)
  await writeFile(fullPath, buf)
  return fullPath
}

function mapAspectImage(a: '9:16' | '16:9' | '1:1'): ImageAspectRatio {
  return a
}

/* ==========================================================
   PHASE 1 — IMAGE GENERATION (Nano Banana)
   ========================================================== */

async function runSceneImage(sceneId: number) {
  const scene = await db.query.tiktokScenes.findFirst({
    where: eq(tiktokScenes.id, sceneId),
    with: { campaign: true },
  })
  if (!scene) return
  const campaign = scene.campaign

  const apiKey = await getApiKey(campaign.userId)
  if (!apiKey) {
    await db.update(tiktokScenes).set({
      imageStatus: 'error',
      imageErrorMsg: 'GeminiGen API key belum diatur. Set di Settings.',
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, sceneId))
    return
  }

  const refs = [
    campaign.baseModelPath,
    campaign.productImagePath,
  ].filter((p): p is string => !!p)

  let attempts = scene.imageAttempts ?? 0
  let lastError = ''

  while (attempts < MAX_ATTEMPTS) {
    attempts++
    try {
      await db.update(tiktokScenes).set({
        imageStatus: 'processing',
        imageAttempts: attempts,
        imageErrorMsg: null,
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, sceneId))

      console.log(`[tiktok-img:${sceneId}] Attempt ${attempts}/${MAX_ATTEMPTS}, ${refs.length} ref images`)

      // Belt-and-suspenders: prepend an explicit instruction that the reference
      // images MUST drive the output (face identity + product identity).
      const refHints = refs.length === 2
        ? 'CRITICAL: Reference image 1 is the PERSON\'s face/body — keep their exact facial features, skin tone, hair, and build. Reference image 2 is the PRODUCT — keep its exact packaging, label text, color, and shape. The output must show THIS person holding THIS product. Do not invent new face or new product.\n\n'
        : refs.length === 1
        ? 'CRITICAL: Use the reference image as the SOURCE identity — keep its exact appearance, do not reinterpret.\n\n'
        : ''

      const initial = await generateImage({
        apiKey,
        prompt: refHints + scene.imagePrompt,
        model: 'nano-banana-pro',
        aspectRatio: mapAspectImage(campaign.aspectRatio as '9:16' | '16:9' | '1:1'),
        resolution: campaign.resolution === '1080p' ? '2K' : '1K',
        outputFormat: 'jpeg',
        refImagePaths: refs,
      })

      await db.update(tiktokScenes).set({
        imageGeminigenUuid: initial.uuid,
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, sceneId))

      // Poll until done
      let imageUrl: string | null = null
      if (initial.status === 2 && initial.generate_result) {
        imageUrl = initial.generate_result
      } else if (initial.status === 3) {
        throw new GeminigenError(initial.error_message || 'Image gen failed')
      } else {
        const start = Date.now()
        while (Date.now() - start < IMG_POLL_TIMEOUT_MS) {
          await new Promise(r => setTimeout(r, IMG_POLL_INTERVAL_MS))
          const h = await getImageHistory(initial.uuid, apiKey)
          if (h.status === 2) {
            imageUrl = h.generate_result
              ?? h.generated_image?.[0]?.image_url
              ?? h.generated_image?.[0]?.file_download_url
              ?? null
            break
          }
          if (h.status === 3) {
            throw new GeminigenError(h.error_message || 'Image gen failed')
          }
        }
        if (!imageUrl) throw new GeminigenError('Image polling timeout')
      }

      // Download to local for ref reuse
      const localPath = await downloadToLocal(imageUrl, 'tiktok-images')

      await db.update(tiktokScenes).set({
        imageStatus: 'done',
        imageUrl,
        imagePath: localPath,
        imageErrorMsg: null,
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, sceneId))

      console.log(`[tiktok-img:${sceneId}] DONE`)
      return
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[tiktok-img:${sceneId}] Error attempt ${attempts}: ${lastError}`)
    }

    if (isPermanentValidationError(lastError)) {
      await db.update(tiktokScenes).set({
        imageStatus: 'error',
        imageErrorMsg: `Validation error (no retry): ${lastError}`,
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, sceneId))
      console.warn(`[tiktok-img:${sceneId}] PERMANENT validation error, not retrying: ${lastError}`)
      return
    }

    await db.update(tiktokScenes).set({
      imageErrorMsg: `Attempt ${attempts}: ${lastError}. Retrying...`,
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, sceneId))

    if (attempts < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
  }

  await db.update(tiktokScenes).set({
    imageStatus: 'error',
    imageErrorMsg: `Gagal setelah ${MAX_ATTEMPTS}x. Last: ${lastError}`,
    updatedAt: new Date(),
  }).where(eq(tiktokScenes.id, sceneId))
}

/* ==========================================================
   PHASE 2 — VIDEO GENERATION (Veo)
   ========================================================== */

async function pollVideoUntilDone(uuid: string, apiKey: string, sceneId: number) {
  const start = Date.now()
  while (Date.now() - start < VID_POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, VID_POLL_INTERVAL_MS))
    const history = await getHistory(uuid, apiKey)
    await db.update(tiktokScenes)
      .set({ progress: history.status_percentage ?? 0, updatedAt: new Date() })
      .where(eq(tiktokScenes.id, sceneId))
    if (isTerminalStatus(history.status)) return history
  }
  throw new GeminigenError('Polling timeout')
}

async function runSceneVideo(sceneId: number) {
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

  // Use the generated scene image as first frame for max consistency.
  // Fall back to product image if for some reason image wasn't generated.
  const firstImagePath = scene.imagePath ?? campaign.productImagePath ?? null

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

      const isGrok = campaign.veoModel.startsWith('grok')
      console.log(`[tiktok-vid:${sceneId}] Attempt ${attempts}/${MAX_ATTEMPTS} via ${isGrok ? 'Grok' : 'Veo'}`)

      const generated = isGrok
        ? await generateGrok({
            apiKey,
            prompt: scene.veoPrompt,
            model: 'grok-3',
            // Grok max is 720p; downshift 1080p requests
            resolution: (campaign.resolution === '1080p' ? '720p' : campaign.resolution) as GrokResolution,
            aspectRatio: mapVeoAspectToGrok(campaign.aspectRatio as '16:9' | '9:16' | '1:1'),
            // Grok allowed: 6/10/15 — snap our 8s default to 10
            // Real Grok API caps duration at 10s despite the docs listing 15.
            duration: (scene.duration <= 6 ? 6 : 10) as GrokDuration,
            mode: 'normal',
            refImagePaths: firstImagePath ? [firstImagePath] : [],
          })
        : await generateVeo({
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

      const history = await pollVideoUntilDone(generated.uuid, apiKey, sceneId)

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
        console.log(`[tiktok-vid:${sceneId}] DONE`)
        return
      }

      lastError = history.error_message || history.status_desc || 'Generation failed'
      console.warn(`[tiktok-vid:${sceneId}] Fail attempt ${attempts}: ${lastError}`)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[tiktok-vid:${sceneId}] Error attempt ${attempts}: ${lastError}`)
    }

    if (isPermanentValidationError(lastError)) {
      await db.update(tiktokScenes).set({
        status: 'error',
        errorMsg: `Validation error (no retry): ${lastError}`,
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, sceneId))
      await notify({
        userId: campaign.userId,
        type: 'tiktok_scene_failed',
        title: `TikTok scene ${scene.sceneNumber} validation error`,
        message: `"${campaign.title}" Scene ${scene.sceneNumber}: ${lastError}`,
      })
      console.warn(`[tiktok-vid:${sceneId}] PERMANENT validation error, not retrying: ${lastError}`)
      return
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
  const allVideoDone = allScenes.every((s) => s.status === 'done')
  if (allVideoDone && allScenes.length > 0) {
    await db.update(tiktokCampaigns)
      .set({ status: 'done', updatedAt: new Date() })
      .where(eq(tiktokCampaigns.id, campaignId))
    const campaign = await db.query.tiktokCampaigns.findFirst({ where: eq(tiktokCampaigns.id, campaignId) })
    if (campaign) {
      await notify({
        userId,
        type: 'tiktok_campaign_done',
        title: `TikTok campaign selesai`,
        message: `"${campaign.title}" — semua ${allScenes.length} scene berhasil generate video`,
      })
    }
  }
}

export async function recoverPendingTiktokScenes() {
  const pending = await db.query.tiktokScenes.findMany({
    where: (s, { or, eq }) => or(
      eq(s.imageStatus, 'queued'),
      eq(s.imageStatus, 'processing'),
      eq(s.status, 'queued'),
      eq(s.status, 'processing'),
    ),
  })
  for (const s of pending) {
    if (s.imageStatus === 'queued' || s.imageStatus === 'processing') {
      console.log(`[tiktok-img] Recovering scene ${s.id} (image_status: ${s.imageStatus})`)
      enqueueTiktokImage(s.id)
    }
    if (s.status === 'queued' || s.status === 'processing') {
      console.log(`[tiktok-vid] Recovering scene ${s.id} (status: ${s.status})`)
      enqueueTiktokVideo(s.id)
    }
  }
}
