// TikTok Studio worker — frame-based pipeline.
// Phase 1: each frame in tiktok_frames is generated independently (Nano Banana).
// Phase 2: each scene uses scene.startFrame.imagePath + scene.endFrame.imagePath
//          as Veo first_image + last_image so the clip morphs between them.

import { eq } from 'drizzle-orm'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { db, tiktokScenes, tiktokCampaigns, tiktokFrames, users } from '../db'
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
const MAX_ATTEMPTS = 2           // image phase: 1 retry on transient network error, then give up
const MAX_VIDEO_ATTEMPTS = 1     // video phase: NO auto-retry — user manually retries via UI
const RETRY_DELAY_MS = 12_000
const VID_POLL_INTERVAL_MS = 10_000
const VID_POLL_TIMEOUT_MS = 30 * 60_000
const IMG_POLL_INTERVAL_MS = 3_000
const IMG_POLL_TIMEOUT_MS = 5 * 60_000

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

function isPermanentValidationError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('must be between') ||
    m.includes('invalid value') ||
    m.includes('validation failed') ||
    m.includes('not allowed') ||
    m.includes('unsupported') ||
    m.includes('content policy') ||
    m.includes('400 bad request')
  )
}

// =========== queues ===========
let imgActive = 0
let vidActive = 0
const imgQueue: number[] = []  // frame IDs
const vidQueue: number[] = []  // scene IDs

function pumpImg() {
  while (imgActive < MAX_CONCURRENT_IMG && imgQueue.length > 0) {
    const id = imgQueue.shift()!
    imgActive++
    runFrame(id)
      .catch((err) => console.error(`[tiktok-frame:${id}]`, err))
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

export function enqueueTiktokFrame(frameId: number) {
  if (!imgQueue.includes(frameId)) imgQueue.push(frameId)
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
   PHASE 1 — FRAME GENERATION (Nano Banana)
   ========================================================== */

async function runFrame(frameId: number) {
  const frame = await db.query.tiktokFrames.findFirst({
    where: eq(tiktokFrames.id, frameId),
    with: { campaign: true },
  })
  if (!frame) return
  const campaign = frame.campaign

  const apiKey = await getApiKey(campaign.userId)
  if (!apiKey) {
    await db.update(tiktokFrames).set({
      status: 'error',
      errorMsg: 'GeminiGen API key belum diatur. Set di Settings.',
      updatedAt: new Date(),
    }).where(eq(tiktokFrames.id, frameId))
    return
  }

  // Chain reference: frame N uses the previous frame's image as an extra anchor
  // so consecutive frames stay visually consistent.
  let prevFramePath: string | null = null
  if (frame.frameNumber > 0) {
    const prev = await db.query.tiktokFrames.findFirst({
      where: (f, { and, eq }) => and(eq(f.campaignId, campaign.id), eq(f.frameNumber, frame.frameNumber - 1)),
    })
    if (prev?.imagePath) prevFramePath = prev.imagePath
  }

  const refs = [
    campaign.baseModelPath,
    campaign.productImagePath,
    prevFramePath,
  ].filter((p): p is string => !!p)

  let attempts = frame.attempts ?? 0
  let lastError = ''

  while (attempts < MAX_ATTEMPTS) {
    attempts++
    try {
      await db.update(tiktokFrames).set({
        status: 'processing',
        attempts,
        errorMsg: null,
        updatedAt: new Date(),
      }).where(eq(tiktokFrames.id, frameId))

      console.log(`[tiktok-frame:${frameId}] Attempt ${attempts}/${MAX_ATTEMPTS}, ${refs.length} ref images`)

      const refHints = refs.length === 2
        ? 'CRITICAL: Reference image 1 is the PERSON\'s face/body — keep their exact facial features, skin tone, hair, and build. Reference image 2 is the PRODUCT — keep its exact packaging, label text, color, and shape.\n\n'
        : refs.length === 1
        ? 'CRITICAL: Use the reference image as the SOURCE identity — keep its exact appearance.\n\n'
        : ''

      const initial = await generateImage({
        apiKey,
        prompt: refHints + frame.imagePrompt,
        model: 'nano-banana-pro',
        aspectRatio: mapAspectImage(campaign.aspectRatio as '9:16' | '16:9' | '1:1'),
        resolution: campaign.resolution === '1080p' ? '2K' : '1K',
        outputFormat: 'jpeg',
        refImagePaths: refs,
      })

      await db.update(tiktokFrames).set({
        geminigenUuid: initial.uuid,
        updatedAt: new Date(),
      }).where(eq(tiktokFrames.id, frameId))

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
          if (h.status === 3) throw new GeminigenError(h.error_message || 'Image gen failed')
        }
        if (!imageUrl) throw new GeminigenError('Image polling timeout')
      }

      const localPath = await downloadToLocal(imageUrl, 'tiktok-frames')

      await db.update(tiktokFrames).set({
        status: 'done',
        imageUrl,
        imagePath: localPath,
        errorMsg: null,
        updatedAt: new Date(),
      }).where(eq(tiktokFrames.id, frameId))

      console.log(`[tiktok-frame:${frameId}] DONE`)
      // Auto-chain: queue the next frame in this campaign so it can reference
      // this frame's image. Only triggers if the next frame is still 'draft'.
      const next = await db.query.tiktokFrames.findFirst({
        where: (f, { and, eq }) => and(eq(f.campaignId, campaign.id), eq(f.frameNumber, frame.frameNumber + 1)),
      })
      if (next && next.status === 'draft') {
        await db.update(tiktokFrames)
          .set({ status: 'queued', attempts: 0, errorMsg: null, updatedAt: new Date() })
          .where(eq(tiktokFrames.id, next.id))
        enqueueTiktokFrame(next.id)
      }
      await maybeMarkImagesDone(campaign.id)
      return
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[tiktok-frame:${frameId}] Error attempt ${attempts}: ${lastError}`)
    }

    if (isPermanentValidationError(lastError)) {
      await db.update(tiktokFrames).set({
        status: 'error',
        errorMsg: `Validation error (no retry): ${lastError}`,
        updatedAt: new Date(),
      }).where(eq(tiktokFrames.id, frameId))
      return
    }

    await db.update(tiktokFrames).set({
      errorMsg: `Attempt ${attempts}: ${lastError}. Retrying...`,
      updatedAt: new Date(),
    }).where(eq(tiktokFrames.id, frameId))

    if (attempts < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
  }

  await db.update(tiktokFrames).set({
    status: 'error',
    errorMsg: `Gagal setelah ${MAX_ATTEMPTS}x. Last: ${lastError}`,
    updatedAt: new Date(),
  }).where(eq(tiktokFrames.id, frameId))
}

async function maybeMarkImagesDone(campaignId: number) {
  const frames = await db.query.tiktokFrames.findMany({ where: eq(tiktokFrames.campaignId, campaignId) })
  if (frames.length === 0) return
  const allDone = frames.every(f => f.status === 'done')
  if (allDone) {
    await db.update(tiktokCampaigns)
      .set({ status: 'images_done', updatedAt: new Date() })
      .where(eq(tiktokCampaigns.id, campaignId))
  }
}

/* ==========================================================
   PHASE 2 — VIDEO GENERATION (Veo / Grok / Kling)
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
    with: {
      campaign: true,
      startFrame: true,
      endFrame: true,
    },
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

  // Veo first_image = scene's start frame, last_image = scene's end frame.
  // Fall back to product image if a frame is missing for some reason.
  const firstImagePath = scene.startFrame?.imagePath ?? campaign.productImagePath ?? null
  const lastImagePath = scene.endFrame?.imagePath ?? null

  let attempts = scene.attempts ?? 0
  let lastError = ''

  while (attempts < MAX_VIDEO_ATTEMPTS) {
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
      console.log(`[tiktok-vid:${sceneId}] Attempt ${attempts}/${MAX_VIDEO_ATTEMPTS} via ${isGrok ? 'Grok' : 'Veo'}`)

      const generated = isGrok
        ? await generateGrok({
            apiKey,
            prompt: scene.veoPrompt,
            model: 'grok-3',
            resolution: (campaign.resolution === '1080p' ? '720p' : campaign.resolution) as GrokResolution,
            aspectRatio: mapVeoAspectToGrok(campaign.aspectRatio as '16:9' | '9:16' | '1:1'),
            duration: (scene.duration <= 6 ? 6 : 10) as GrokDuration,
            mode: 'normal',
            refImagePaths: [firstImagePath, lastImagePath].filter((p): p is string => !!p),
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
            lastImagePath,
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
      return
    }

    await db.update(tiktokScenes).set({
      errorMsg: `Attempt ${attempts}: ${lastError}`,
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, sceneId))

    if (attempts < MAX_VIDEO_ATTEMPTS) await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
  }

  await db.update(tiktokScenes).set({
    status: 'error',
    errorMsg: lastError,
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
        message: `"${campaign.title}" — semua ${allScenes.length} scene selesai`,
      })
    }
  }
}

export async function recoverPendingTiktokScenes() {
  // Frames: safe to re-queue because Nano Banana calls are cheap & idempotent enough
  const pendingFrames = await db.query.tiktokFrames.findMany({
    where: (f, { or, eq }) => or(eq(f.status, 'queued'), eq(f.status, 'processing')),
  })
  for (const f of pendingFrames) {
    console.log(`[tiktok-frame] Recovering #${f.id}`)
    enqueueTiktokFrame(f.id)
  }

  // Videos: do NOT re-queue 'processing' scenes — they likely still have a
  // pending Veo job at GeminiGen. We poll the existing UUID instead so we
  // don't waste credits creating duplicate requests.
  const processingScenes = await db.query.tiktokScenes.findMany({
    where: eq(tiktokScenes.status, 'processing'),
  })
  for (const s of processingScenes) {
    if (!s.geminigenUuid) {
      // Edge case: status=processing but no UUID — mark error so user can retry
      await db.update(tiktokScenes).set({
        status: 'error',
        errorMsg: 'Recovered after restart, no UUID — please retry manually',
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, s.id))
      continue
    }
    console.log(`[tiktok-vid] Re-attaching to existing job ${s.geminigenUuid} for scene #${s.id}`)
    // Just enqueue and the worker's poll will pick up the existing UUID via runSceneVideo's normal flow.
    // (The first attempt of runSceneVideo creates a NEW request — to AVOID that, we keep status as is
    //  and just mark for manual retry. Safer.)
    await db.update(tiktokScenes).set({
      status: 'error',
      errorMsg: 'Restart terjadi saat video processing — klik Retry untuk lanjut',
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, s.id))
  }

  // 'queued' scenes are safe to re-queue (no Veo call has been made yet)
  const queuedScenes = await db.query.tiktokScenes.findMany({
    where: eq(tiktokScenes.status, 'queued'),
  })
  for (const s of queuedScenes) {
    console.log(`[tiktok-vid] Recovering queued scene #${s.id}`)
    enqueueTiktokVideo(s.id)
  }
}
