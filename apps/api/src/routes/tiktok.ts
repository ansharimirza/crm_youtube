import { Elysia, t } from 'elysia'
import { and, desc, eq } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { db, users, tiktokCampaigns, tiktokScenes } from '../db'
import { authMiddleware } from '../middleware/auth'
import { enqueueTiktokImage, enqueueTiktokVideo } from '../lib/tiktok-worker'
import {
  identifyProductFromImage,
  extractProductFromHtml,
  enrichProductFromTitleAndImage,
  suggestEnvironments,
  generateSceneScripts,
  AnthropicError,
  type TiktokMode,
  type ContentType,
  type ProductInfo,
} from '../lib/anthropic'
import { scrapeProductUrl, ScrapeError } from '../lib/tiktok-scraper'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const TIKTOK_DIR = join(UPLOAD_DIR, 'tiktok')
await mkdir(TIKTOK_DIR, { recursive: true })

async function saveFile(file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = join(TIKTOK_DIR, name)
  await Bun.write(path, file)
  return path
}

async function getAnthropicKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user?.anthropicApiKey) return user.anthropicApiKey
  return process.env.ANTHROPIC_API_KEY ?? null
}

export const tiktokRoutes = new Elysia({ prefix: '/api/tiktok' })
  .use(authMiddleware)

  // === 1. SCRAPE PRODUCT URL ===
  .post('/scrape-product', async ({ body, user, set }) => {
    const apiKey = await getAnthropicKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Anthropic API key belum diatur di Settings' }
    }

    try {
      const scraped = await scrapeProductUrl(body.url)

      // TikTok Shop redirect: only has title + image. Enrich via Claude vision.
      if (scraped.source === 'tiktok_redirect') {
        try {
          const product = await enrichProductFromTitleAndImage({
            title: scraped.name,
            imageUrl: scraped.image_url,
            apiKey,
          })
          return { ok: true, product, image_url: scraped.image_url, source: scraped.source }
        } catch (err) {
          // Fallback: return title-only product, user can fill rest manually
          console.error('[tiktok enrich]', err)
          const product: ProductInfo = {
            name: scraped.name,
            description: scraped.name,
            category: '',
            key_features: [],
            brand: '',
            detected_text: '',
          }
          return { ok: true, product, image_url: scraped.image_url, source: scraped.source }
        }
      }

      // Meta tags / JSON-LD path — has proper description already
      if (scraped.source !== 'html' && scraped.name && scraped.description) {
        const product: ProductInfo = {
          name: scraped.name,
          description: scraped.description,
          category: '',
          key_features: [],
          brand: '',
          detected_text: '',
        }
        return { ok: true, product, image_url: scraped.image_url, source: scraped.source }
      }

      if (scraped.raw_html) {
        const product = await extractProductFromHtml(scraped.raw_html, apiKey)
        // Tokopedia / Shopee SPA — HTML kosong, Claude balikin field kosong.
        if (!product.name?.trim() && !product.description?.trim()) {
          set.status = 400
          return {
            ok: false,
            error: 'Site ini SPA / dilindungi anti-bot (Tokopedia/Shopee). Coba upload gambar produk manual.',
          }
        }
        return { ok: true, product, image_url: scraped.image_url, source: 'claude_html' }
      }

      set.status = 400
      return { error: 'Tidak bisa extract info produk dari URL ini. Coba upload gambar produk.' }
    } catch (err) {
      const msg = err instanceof ScrapeError || err instanceof AnthropicError
        ? err.message
        : err instanceof Error ? err.message : String(err)
      console.error('[tiktok scrape]', msg)
      set.status = 500
      return { ok: false, error: msg }
    }
  }, {
    body: t.Object({ url: t.String({ minLength: 8, maxLength: 2000 }) }),
  })

  // === 2. ANALYZE PRODUCT IMAGE ===
  .post('/analyze-image', async ({ body, user, set }) => {
    const apiKey = await getAnthropicKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Anthropic API key belum diatur di Settings' }
    }

    if (!body.image) {
      set.status = 400
      return { error: 'Image file wajib' }
    }

    const imagePath = await saveFile(body.image, 'tiktok-product')
    try {
      const product = await identifyProductFromImage(imagePath, apiKey)
      return { ok: true, product, image_path: imagePath }
    } catch (err) {
      const msg = err instanceof AnthropicError ? err.message
        : err instanceof Error ? err.message : String(err)
      console.error('[tiktok analyze]', msg)
      set.status = 500
      return { ok: false, error: msg }
    }
  }, {
    body: t.Object({ image: t.File() }),
  })

  // === 3. SUGGEST ENVIRONMENTS ===
  .post('/suggest-environments', async ({ body, user, set }) => {
    const apiKey = await getAnthropicKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Anthropic API key belum diatur di Settings' }
    }

    try {
      const environments = await suggestEnvironments(body.product, body.language, apiKey)
      return { ok: true, environments }
    } catch (err) {
      const msg = err instanceof AnthropicError ? err.message
        : err instanceof Error ? err.message : String(err)
      set.status = 500
      return { ok: false, error: msg }
    }
  }, {
    body: t.Object({
      product: t.Object({
        name: t.String(),
        description: t.String(),
        category: t.String(),
        key_features: t.Array(t.String()),
        brand: t.String(),
        detected_text: t.Optional(t.String()),
      }),
      language: t.Union([t.Literal('id'), t.Literal('en')]),
    }),
  })

  // === 4. CREATE CAMPAIGN + GENERATE SCRIPTS + QUEUE IMAGES (phase 1) ===
  .post('/campaigns', async ({ body, user, set }) => {
    const apiKey = await getAnthropicKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Anthropic API key belum diatur di Settings' }
    }

    let baseModelPath: string | null = null
    if (body.base_model_image) {
      baseModelPath = await saveFile(body.base_model_image, 'tiktok-base')
    }

    let productImagePath: string | null = body.product_image_path ?? null
    if (body.product_image) {
      productImagePath = await saveFile(body.product_image, 'tiktok-product')
    }

    const product: ProductInfo = {
      name: body.product_name,
      description: body.product_description,
      category: body.product_category ?? '',
      key_features: body.product_features ? body.product_features.split('|').filter(Boolean) : [],
      brand: body.product_brand ?? '',
      detected_text: '',
    }

    // Generate scripts via Claude (includes image_prompt + veo_prompt per scene)
    let scripts
    try {
      scripts = await generateSceneScripts({
        apiKey,
        mode: body.mode as TiktokMode,
        contentType: body.content_type as ContentType,
        language: body.language as 'id' | 'en',
        productInfo: product,
        environment: body.environment,
        sceneCount: Number(body.scene_count),
        aspectRatio: body.aspect_ratio as '9:16' | '16:9' | '1:1',
      })
    } catch (err) {
      const msg = err instanceof AnthropicError ? err.message
        : err instanceof Error ? err.message : String(err)
      console.error('[tiktok create] Claude error:', msg)
      set.status = 500
      return { ok: false, error: `Script generation gagal: ${msg}` }
    }

    if (!scripts || scripts.length === 0) {
      set.status = 500
      return { ok: false, error: 'Claude tidak return scene scripts' }
    }

    const [campaign] = await db.insert(tiktokCampaigns).values({
      userId: user.id,
      title: body.title,
      mode: body.mode as 'ugc' | 'pov_hand' | 'mirror_check',
      contentType: body.content_type as 'review' | 'unboxing' | 'affiliate',
      language: body.language as 'id' | 'en',
      baseModelPath,
      productImagePath,
      productUrl: body.product_url ?? null,
      productName: product.name,
      productDescription: product.description,
      environment: body.environment,
      aspectRatio: body.aspect_ratio as '9:16' | '16:9' | '1:1',
      resolution: (body.resolution ?? '1080p') as '720p' | '1080p',
      veoModel: body.veo_model ?? 'veo-2',
      sceneCount: Number(body.scene_count),
      status: 'generating',
    }).returning()

    const sceneIds: number[] = []
    for (const s of scripts) {
      const [scene] = await db.insert(tiktokScenes).values({
        campaignId: campaign.id,
        sceneNumber: s.scene_number,
        script: s.script,
        imagePrompt: s.image_prompt,
        veoPrompt: s.veo_prompt,
        duration: s.duration,
        imageStatus: 'queued',
        status: 'pending',
      }).returning()
      sceneIds.push(scene.id)
    }

    // Auto-start IMAGE generation (phase 1). Video phase waits for user click.
    if (body.auto_start !== 'false') {
      for (const id of sceneIds) enqueueTiktokImage(id)
    }

    return { ok: true, campaign, scene_count: sceneIds.length }
  }, {
    body: t.Object({
      title: t.String({ minLength: 1, maxLength: 200 }),
      mode: t.Union([t.Literal('ugc'), t.Literal('pov_hand'), t.Literal('mirror_check')]),
      content_type: t.Union([t.Literal('review'), t.Literal('unboxing'), t.Literal('affiliate')]),
      language: t.Union([t.Literal('id'), t.Literal('en')]),
      product_name: t.String({ minLength: 1, maxLength: 255 }),
      product_description: t.String({ maxLength: 2000 }),
      product_category: t.Optional(t.String({ maxLength: 100 })),
      product_brand: t.Optional(t.String({ maxLength: 100 })),
      product_features: t.Optional(t.String({ maxLength: 2000 })),
      product_url: t.Optional(t.String({ maxLength: 2000 })),
      product_image: t.Optional(t.File()),
      product_image_path: t.Optional(t.String()),
      base_model_image: t.Optional(t.File()),
      environment: t.String({ minLength: 1, maxLength: 500 }),
      aspect_ratio: t.Union([t.Literal('9:16'), t.Literal('16:9'), t.Literal('1:1')]),
      resolution: t.Optional(t.Union([t.Literal('720p'), t.Literal('1080p')])),
      veo_model: t.Optional(t.String()),
      scene_count: t.String(),
      auto_start: t.Optional(t.String()),
    }),
  })

  // === LIST CAMPAIGNS ===
  .get('/campaigns', async ({ user }) => {
    const list = await db.query.tiktokCampaigns.findMany({
      where: eq(tiktokCampaigns.userId, user.id),
      orderBy: [desc(tiktokCampaigns.createdAt)],
      with: {
        scenes: { columns: { id: true, status: true, imageStatus: true, imageUrl: true, videoUrl: true, thumbnailUrl: true } },
      },
    })
    const campaigns = list.map(c => ({
      id: c.id,
      title: c.title,
      mode: c.mode,
      contentType: c.contentType,
      language: c.language,
      productName: c.productName,
      status: c.status,
      sceneCount: c.sceneCount,
      imageDoneCount: c.scenes.filter(s => s.imageStatus === 'done').length,
      doneCount: c.scenes.filter(s => s.status === 'done').length,
      processingCount: c.scenes.filter(s =>
        s.imageStatus === 'processing' || s.imageStatus === 'queued' ||
        s.status === 'processing' || s.status === 'queued'
      ).length,
      errorCount: c.scenes.filter(s => s.imageStatus === 'error' || s.status === 'error').length,
      thumbnail: c.scenes.find(s => s.thumbnailUrl)?.thumbnailUrl
        ?? c.scenes.find(s => s.imageUrl)?.imageUrl
        ?? null,
      createdAt: c.createdAt,
    }))
    return { campaigns }
  })

  // === GET CAMPAIGN DETAIL ===
  .get('/campaigns/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const campaign = await db.query.tiktokCampaigns.findFirst({
      where: and(eq(tiktokCampaigns.id, id), eq(tiktokCampaigns.userId, user.id)),
      with: {
        scenes: { orderBy: [tiktokScenes.sceneNumber] },
      },
    })
    if (!campaign) {
      set.status = 404
      return { error: 'Campaign tidak ditemukan' }
    }
    return { campaign }
  })

  // === REVISE SCENE IMAGE (regenerate Nano Banana with appended instruction) ===
  .post('/scenes/:id/revise-image', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.tiktokScenes.findFirst({
      where: eq(tiktokScenes.id, id),
      with: { campaign: true },
    })
    if (!scene || scene.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (scene.imageStatus === 'processing' || scene.imageStatus === 'queued') {
      set.status = 400
      return { error: 'Image masih dalam proses' }
    }

    const instruction = body.instruction?.trim() ?? ''
    const newPrompt = instruction
      ? `${scene.imagePrompt}\n\nADJUSTMENT: ${instruction}`
      : scene.imagePrompt

    await db.update(tiktokScenes).set({
      imagePrompt: newPrompt,
      imageStatus: 'queued',
      imageAttempts: 0,
      imageErrorMsg: null,
      imageUrl: null,
      imagePath: null,
      imageGeminigenUuid: null,
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, id))

    enqueueTiktokImage(id)
    return { ok: true }
  }, {
    body: t.Object({
      instruction: t.Optional(t.String({ maxLength: 1000 })),
    }),
  })

  // === UPDATE SCRIPT TEXT (no regen) ===
  .patch('/scenes/:id/script', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.tiktokScenes.findFirst({
      where: eq(tiktokScenes.id, id),
      with: { campaign: true },
    })
    if (!scene || scene.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.update(tiktokScenes).set({
      script: body.script,
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, id))
    return { ok: true }
  }, {
    body: t.Object({ script: t.String({ maxLength: 2000 }) }),
  })

  // === UPDATE PROMPTS (image_prompt and/or veo_prompt) ===
  .patch('/scenes/:id/prompt', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.tiktokScenes.findFirst({
      where: eq(tiktokScenes.id, id),
      with: { campaign: true },
    })
    if (!scene || scene.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    const updates: Partial<typeof tiktokScenes.$inferInsert> = { updatedAt: new Date() }
    if (body.image_prompt !== undefined) updates.imagePrompt = body.image_prompt
    if (body.veo_prompt !== undefined) updates.veoPrompt = body.veo_prompt
    await db.update(tiktokScenes).set(updates).where(eq(tiktokScenes.id, id))

    // If image_prompt changed and user wants to regenerate, queue image again
    if (body.image_prompt !== undefined && body.regen) {
      await db.update(tiktokScenes).set({
        imageStatus: 'queued',
        imageAttempts: 0,
        imageErrorMsg: null,
      }).where(eq(tiktokScenes.id, id))
      enqueueTiktokImage(id)
    }
    return { ok: true }
  }, {
    body: t.Object({
      image_prompt: t.Optional(t.String({ maxLength: 4000 })),
      veo_prompt: t.Optional(t.String({ maxLength: 4000 })),
      regen: t.Optional(t.Boolean()),
    }),
  })

  // === GENERATE VIDEO for ONE scene (phase 2) ===
  .post('/scenes/:id/generate-video', async ({ params, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.tiktokScenes.findFirst({
      where: eq(tiktokScenes.id, id),
      with: { campaign: true },
    })
    if (!scene || scene.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (scene.imageStatus !== 'done') {
      set.status = 400
      return { error: 'Image belum selesai. Tunggu image generate dulu.' }
    }
    if (scene.status === 'processing' || scene.status === 'queued') {
      set.status = 400
      return { error: 'Video sedang dalam proses' }
    }

    await db.update(tiktokScenes).set({
      status: 'queued',
      progress: 0,
      attempts: 0,
      errorMsg: null,
      geminigenUuid: null,
      geminigenId: null,
      videoUrl: null,
      thumbnailUrl: null,
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, id))

    enqueueTiktokVideo(id)
    return { ok: true }
  })

  // === GENERATE ALL VIDEOS for a campaign (bulk phase 2) ===
  .post('/campaigns/:id/generate-videos', async ({ params, user, set }) => {
    const id = Number(params.id)
    const campaign = await db.query.tiktokCampaigns.findFirst({
      where: and(eq(tiktokCampaigns.id, id), eq(tiktokCampaigns.userId, user.id)),
      with: { scenes: true },
    })
    if (!campaign) {
      set.status = 404
      return { error: 'Not found' }
    }

    // Only kick scenes whose image is done and video is pending/error
    const eligible = campaign.scenes.filter(s =>
      s.imageStatus === 'done' && (s.status === 'pending' || s.status === 'error')
    )
    if (eligible.length === 0) {
      set.status = 400
      return { error: 'Tidak ada scene yang siap. Pastikan image sudah selesai.' }
    }

    for (const s of eligible) {
      await db.update(tiktokScenes).set({
        status: 'queued',
        progress: 0,
        attempts: 0,
        errorMsg: null,
        geminigenUuid: null,
        geminigenId: null,
        videoUrl: null,
        thumbnailUrl: null,
        updatedAt: new Date(),
      }).where(eq(tiktokScenes.id, s.id))
      enqueueTiktokVideo(s.id)
    }

    await db.update(tiktokCampaigns)
      .set({ status: 'generating', updatedAt: new Date() })
      .where(eq(tiktokCampaigns.id, id))

    return { ok: true, queued: eligible.length }
  })

  // === RETRY IMAGE (failed scenes) ===
  .post('/scenes/:id/retry-image', async ({ params, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.tiktokScenes.findFirst({
      where: eq(tiktokScenes.id, id),
      with: { campaign: true },
    })
    if (!scene || scene.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.update(tiktokScenes).set({
      imageStatus: 'queued',
      imageAttempts: 0,
      imageErrorMsg: null,
      updatedAt: new Date(),
    }).where(eq(tiktokScenes.id, id))
    enqueueTiktokImage(id)
    return { ok: true }
  })

  // === DOWNLOAD ALL DONE VIDEOS AS ZIP ===
  .get('/campaigns/:id/download-zip', async ({ params, user, set }) => {
    const id = Number(params.id)
    const campaign = await db.query.tiktokCampaigns.findFirst({
      where: and(eq(tiktokCampaigns.id, id), eq(tiktokCampaigns.userId, user.id)),
      with: { scenes: { orderBy: [tiktokScenes.sceneNumber] } },
    })
    if (!campaign) {
      set.status = 404
      return { error: 'Campaign tidak ditemukan' }
    }

    const doneScenes = campaign.scenes.filter(s => s.status === 'done' && s.videoUrl)
    if (doneScenes.length === 0) {
      set.status = 400
      return { error: 'Belum ada video scene yang selesai untuk di-download' }
    }

    const zip = new JSZip()
    let added = 0

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
        }
      }
    }

    if (added === 0) {
      set.status = 500
      return { error: 'Gagal download semua video' }
    }

    const safeTitle = campaign.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'tiktok-campaign'
    const zipBuf = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 },
    })

    set.headers['Content-Type'] = 'application/zip'
    set.headers['Content-Disposition'] = `attachment; filename="${safeTitle}.zip"`
    set.headers['Content-Length'] = String(zipBuf.byteLength)
    return new Response(zipBuf)
  })

  // === DELETE CAMPAIGN ===
  .delete('/campaigns/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const existing = await db.query.tiktokCampaigns.findFirst({
      where: and(eq(tiktokCampaigns.id, id), eq(tiktokCampaigns.userId, user.id)),
    })
    if (!existing) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.delete(tiktokCampaigns).where(eq(tiktokCampaigns.id, id))
    return { ok: true }
  })
