import { Elysia, t } from 'elysia'
import { and, desc, eq } from 'drizzle-orm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { db, users, tiktokCampaigns, tiktokScenes, tiktokFrames } from '../db'
import { authMiddleware } from '../middleware/auth'
import { enqueueTiktokFrame, enqueueTiktokVideo } from '../lib/tiktok-worker'
import {
  identifyProductFromImage,
  extractProductFromHtml,
  enrichProductFromTitleAndImage,
  suggestEnvironments,
  generateSceneScripts,
  generateHookVariants,
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
      const environments = await suggestEnvironments(
        { ...body.product, detected_text: body.product.detected_text ?? '' },
        body.language,
        apiKey,
      )
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

  // === 4. CREATE CAMPAIGN + GENERATE DRAFT (no image gen yet) ===
  // Flow: Claude generates frames + scenes -> save as draft.
  // User reviews on detail page, edits, then POSTs /campaigns/:id/approve to queue image gen.
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

    // Generate Claude draft (frames + scenes) — image gen happens AFTER user approves
    let draft
    try {
      draft = await generateSceneScripts({
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

    if (!draft.scenes.length || !draft.frames.length) {
      set.status = 500
      return { ok: false, error: 'Claude tidak return draft' }
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
      status: 'draft',  // awaits user approval before image gen
    }).returning()

    // Insert frames first so we have their IDs
    const frameIds: number[] = []
    for (const f of draft.frames) {
      const [frame] = await db.insert(tiktokFrames).values({
        campaignId: campaign.id,
        frameNumber: f.frame_number,
        imagePrompt: f.image_prompt,
        status: 'draft',
      }).returning()
      frameIds.push(frame.id)
    }

    // Then scenes, with frame references
    for (const s of draft.scenes) {
      await db.insert(tiktokScenes).values({
        campaignId: campaign.id,
        sceneNumber: s.scene_number,
        script: s.script,
        veoPrompt: s.veo_prompt,
        duration: s.duration,
        startFrameId: frameIds[s.start_frame_index] ?? null,
        endFrameId: frameIds[s.end_frame_index] ?? null,
        status: 'pending',
      })
    }

    return { ok: true, campaign }
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
    }),
  })

  // === LIST CAMPAIGNS ===
  .get('/campaigns', async ({ user }) => {
    const list = await db.query.tiktokCampaigns.findMany({
      where: eq(tiktokCampaigns.userId, user.id),
      orderBy: [desc(tiktokCampaigns.createdAt)],
      with: {
        scenes: { columns: { id: true, status: true, videoUrl: true, thumbnailUrl: true } },
        frames: { columns: { id: true, status: true, imageUrl: true } },
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
      frameDoneCount: c.frames.filter(f => f.status === 'done').length,
      frameTotal: c.frames.length,
      videoDoneCount: c.scenes.filter(s => s.status === 'done').length,
      processingCount: c.frames.filter(f => f.status === 'processing' || f.status === 'queued').length
        + c.scenes.filter(s => s.status === 'processing' || s.status === 'queued').length,
      errorCount: c.frames.filter(f => f.status === 'error').length + c.scenes.filter(s => s.status === 'error').length,
      thumbnail: c.scenes.find(s => s.thumbnailUrl)?.thumbnailUrl
        ?? c.frames.find(f => f.imageUrl)?.imageUrl
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
        frames: { orderBy: [tiktokFrames.frameNumber] },
      },
    })
    if (!campaign) {
      set.status = 404
      return { error: 'Campaign tidak ditemukan' }
    }
    return { campaign }
  })

  // === REVISE SCENE IMAGE (regenerate Nano Banana with appended instruction) ===
  // === GENERATE HOOK VARIANTS for a scene (Claude gives 3 fresh openers) ===
  .post('/scenes/:id/hook-variants', async ({ params, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.tiktokScenes.findFirst({
      where: eq(tiktokScenes.id, id),
      with: { campaign: true },
    })
    if (!scene || scene.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    const apiKey = await getAnthropicKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Anthropic API key belum diatur' }
    }

    const product: ProductInfo = {
      name: scene.campaign.productName,
      description: scene.campaign.productDescription,
      category: '',
      key_features: [],
      brand: '',
      detected_text: '',
    }

    try {
      const variants = await generateHookVariants({
        apiKey,
        mode: scene.campaign.mode as TiktokMode,
        contentType: scene.campaign.contentType as ContentType,
        language: scene.campaign.language as 'id' | 'en',
        productInfo: product,
        environment: scene.campaign.environment,
        currentScript: scene.script,
      })
      return { ok: true, variants }
    } catch (err) {
      const msg = err instanceof AnthropicError ? err.message
        : err instanceof Error ? err.message : String(err)
      set.status = 500
      return { ok: false, error: msg }
    }
  })

  // === EDIT SCENE (script + veo_prompt) — allowed any time before video gen ===
  .patch('/scenes/:id', async ({ params, body, user, set }) => {
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
    if (body.script !== undefined) updates.script = body.script
    if (body.veo_prompt !== undefined) updates.veoPrompt = body.veo_prompt
    await db.update(tiktokScenes).set(updates).where(eq(tiktokScenes.id, id))
    return { ok: true }
  }, {
    body: t.Object({
      script: t.Optional(t.String({ maxLength: 2000 })),
      veo_prompt: t.Optional(t.String({ maxLength: 4000 })),
    }),
  })

  // === EDIT FRAME prompt (no regen) ===
  .patch('/frames/:id', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const frame = await db.query.tiktokFrames.findFirst({
      where: eq(tiktokFrames.id, id),
      with: { campaign: true },
    })
    if (!frame || frame.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.update(tiktokFrames).set({
      imagePrompt: body.image_prompt,
      updatedAt: new Date(),
    }).where(eq(tiktokFrames.id, id))
    return { ok: true }
  }, {
    body: t.Object({ image_prompt: t.String({ maxLength: 4000 }) }),
  })

  // === REVISE FRAME (append instruction + regenerate) ===
  .post('/frames/:id/revise', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const frame = await db.query.tiktokFrames.findFirst({
      where: eq(tiktokFrames.id, id),
      with: { campaign: true },
    })
    if (!frame || frame.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (frame.status === 'processing' || frame.status === 'queued') {
      set.status = 400
      return { error: 'Frame masih dalam proses' }
    }
    const instruction = body.instruction?.trim() ?? ''
    const newPrompt = instruction ? `${frame.imagePrompt}\n\nADJUSTMENT: ${instruction}` : frame.imagePrompt
    await db.update(tiktokFrames).set({
      imagePrompt: newPrompt,
      status: 'queued',
      attempts: 0,
      errorMsg: null,
      imageUrl: null,
      imagePath: null,
      geminigenUuid: null,
      updatedAt: new Date(),
    }).where(eq(tiktokFrames.id, id))
    enqueueTiktokFrame(id)
    return { ok: true }
  }, {
    body: t.Object({ instruction: t.Optional(t.String({ maxLength: 1000 })) }),
  })

  // === RETRY FRAME ===
  .post('/frames/:id/retry', async ({ params, user, set }) => {
    const id = Number(params.id)
    const frame = await db.query.tiktokFrames.findFirst({
      where: eq(tiktokFrames.id, id),
      with: { campaign: true },
    })
    if (!frame || frame.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.update(tiktokFrames).set({
      status: 'queued',
      attempts: 0,
      errorMsg: null,
      updatedAt: new Date(),
    }).where(eq(tiktokFrames.id, id))
    enqueueTiktokFrame(id)
    return { ok: true }
  })

  // === APPROVE DRAFT — start frame image generation (phase 1) ===
  .post('/campaigns/:id/approve', async ({ params, user, set }) => {
    const id = Number(params.id)
    const campaign = await db.query.tiktokCampaigns.findFirst({
      where: and(eq(tiktokCampaigns.id, id), eq(tiktokCampaigns.userId, user.id)),
      with: { frames: true },
    })
    if (!campaign) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (campaign.status !== 'draft') {
      set.status = 400
      return { error: `Campaign sudah ${campaign.status} — tidak bisa approve ulang` }
    }
    if (campaign.frames.length === 0) {
      set.status = 400
      return { error: 'Campaign tidak punya frames' }
    }

    await db.update(tiktokCampaigns)
      .set({ status: 'generating_images', updatedAt: new Date() })
      .where(eq(tiktokCampaigns.id, id))

    // Only queue Frame 0. Each frame, when done, will auto-queue the next so
    // it can use the previous frame as a reference image (visual chain).
    const first = campaign.frames.find(f => f.frameNumber === 0)
    if (!first) {
      set.status = 400
      return { error: 'Frame 0 tidak ditemukan' }
    }
    await db.update(tiktokFrames).set({
      status: 'queued',
      attempts: 0,
      errorMsg: null,
    }).where(eq(tiktokFrames.id, first.id))
    enqueueTiktokFrame(first.id)
    return { ok: true, queued: 1, total: campaign.frames.length }
  })

  // === REROLL DRAFT — regenerate via Claude (only allowed in draft state) ===
  .post('/campaigns/:id/reroll', async ({ params, user, set }) => {
    const id = Number(params.id)
    const campaign = await db.query.tiktokCampaigns.findFirst({
      where: and(eq(tiktokCampaigns.id, id), eq(tiktokCampaigns.userId, user.id)),
    })
    if (!campaign) {
      set.status = 404
      return { error: 'Not found' }
    }
    if (campaign.status !== 'draft') {
      set.status = 400
      return { error: 'Reroll hanya bisa saat campaign masih draft' }
    }

    const apiKey = await getAnthropicKey(user.id)
    if (!apiKey) {
      set.status = 400
      return { error: 'Anthropic API key belum diatur di Settings' }
    }

    const product: ProductInfo = {
      name: campaign.productName,
      description: campaign.productDescription,
      category: '',
      key_features: [],
      brand: '',
      detected_text: '',
    }

    let draft
    try {
      draft = await generateSceneScripts({
        apiKey,
        mode: campaign.mode as TiktokMode,
        contentType: campaign.contentType as ContentType,
        language: campaign.language as 'id' | 'en',
        productInfo: product,
        environment: campaign.environment,
        sceneCount: campaign.sceneCount,
        aspectRatio: campaign.aspectRatio as '9:16' | '16:9' | '1:1',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { ok: false, error: `Reroll gagal: ${msg}` }
    }

    // Wipe existing frames + scenes and rebuild
    await db.delete(tiktokScenes).where(eq(tiktokScenes.campaignId, id))
    await db.delete(tiktokFrames).where(eq(tiktokFrames.campaignId, id))

    const frameIds: number[] = []
    for (const f of draft.frames) {
      const [frame] = await db.insert(tiktokFrames).values({
        campaignId: id,
        frameNumber: f.frame_number,
        imagePrompt: f.image_prompt,
        status: 'draft',
      }).returning()
      frameIds.push(frame.id)
    }
    for (const s of draft.scenes) {
      await db.insert(tiktokScenes).values({
        campaignId: id,
        sceneNumber: s.scene_number,
        script: s.script,
        veoPrompt: s.veo_prompt,
        duration: s.duration,
        startFrameId: frameIds[s.start_frame_index] ?? null,
        endFrameId: frameIds[s.end_frame_index] ?? null,
        status: 'pending',
      })
    }
    return { ok: true }
  })

  // === GENERATE VIDEO for ONE scene (phase 2) ===
  .post('/scenes/:id/generate-video', async ({ params, user, set }) => {
    const id = Number(params.id)
    const scene = await db.query.tiktokScenes.findFirst({
      where: eq(tiktokScenes.id, id),
      with: {
        campaign: true,
        startFrame: true,
        endFrame: true,
      },
    })
    if (!scene || scene.campaign.userId !== user.id) {
      set.status = 404
      return { error: 'Not found' }
    }
    const startReady = scene.startFrame?.status === 'done'
    const endReady = scene.endFrame?.status === 'done'
    if (!startReady || !endReady) {
      set.status = 400
      return { error: 'Start dan end frame belum selesai. Tunggu image generate dulu.' }
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

  // === GENERATE ALL VIDEOS (bulk phase 2) ===
  .post('/campaigns/:id/generate-videos', async ({ params, user, set }) => {
    const id = Number(params.id)
    const campaign = await db.query.tiktokCampaigns.findFirst({
      where: and(eq(tiktokCampaigns.id, id), eq(tiktokCampaigns.userId, user.id)),
      with: { scenes: { with: { startFrame: true, endFrame: true } } },
    })
    if (!campaign) {
      set.status = 404
      return { error: 'Not found' }
    }
    const eligible = campaign.scenes.filter(s =>
      s.startFrame?.status === 'done' &&
      s.endFrame?.status === 'done' &&
      (s.status === 'pending' || s.status === 'error')
    )
    if (eligible.length === 0) {
      set.status = 400
      return { error: 'Tidak ada scene yang siap. Pastikan semua frame sudah selesai.' }
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
      .set({ status: 'generating_videos', updatedAt: new Date() })
      .where(eq(tiktokCampaigns.id, id))

    return { ok: true, queued: eligible.length }
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
