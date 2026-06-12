import { Elysia, t } from 'elysia'
import { and, desc, eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { db, users, aiInfluencers } from '../db'
import { authMiddleware } from '../middleware/auth'
import { generateImage, getImageHistory, GeminigenError } from '../lib/geminigen'
import { buildInfluencerImagePrompt, type InfluencerSpec } from '../lib/ai-influencer'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const INFLUENCER_DIR = join(UPLOAD_DIR, 'influencer')
await mkdir(INFLUENCER_DIR, { recursive: true })

async function saveUpload(file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = join(INFLUENCER_DIR, name)
  await Bun.write(path, file)
  return path
}

async function getGeminigenKey(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (user?.geminigenApiKey) return user.geminigenApiKey
  return process.env.GEMINIGEN_API_KEY ?? null
}

async function downloadToLocal(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = extname(new URL(url).pathname) || '.jpg'
  const filename = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
  const fullPath = join(INFLUENCER_DIR, filename)
  await writeFile(fullPath, buf)
  return fullPath
}

const IMG_POLL_INTERVAL_MS = 3_000
const IMG_POLL_TIMEOUT_MS = 5 * 60_000

async function generateInfluencerImage(influencerId: number) {
  const inf = await db.query.aiInfluencers.findFirst({ where: eq(aiInfluencers.id, influencerId) })
  if (!inf) return

  const apiKey = await getGeminigenKey(inf.userId)
  if (!apiKey) {
    await db.update(aiInfluencers).set({
      status: 'error',
      errorMsg: 'GeminiGen API key belum diatur. Set di Settings.',
      updatedAt: new Date(),
    }).where(eq(aiInfluencers.id, influencerId))
    return
  }

  const refs = [inf.faceRefPath, inf.styleRefPath].filter((p): p is string => !!p)

  try {
    await db.update(aiInfluencers).set({
      status: 'processing',
      attempts: (inf.attempts ?? 0) + 1,
      errorMsg: null,
      updatedAt: new Date(),
    }).where(eq(aiInfluencers.id, influencerId))

    const initial = await generateImage({
      apiKey,
      prompt: inf.imagePrompt,
      model: 'nano-banana-pro',
      aspectRatio: '9:16',
      resolution: '2K',
      outputFormat: 'jpeg',
      refImagePaths: refs,
    })

    await db.update(aiInfluencers).set({
      imageGeminigenUuid: initial.uuid,
      updatedAt: new Date(),
    }).where(eq(aiInfluencers.id, influencerId))

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

    const localPath = await downloadToLocal(imageUrl)

    await db.update(aiInfluencers).set({
      status: 'done',
      imageUrl,
      imagePath: localPath,
      errorMsg: null,
      updatedAt: new Date(),
    }).where(eq(aiInfluencers.id, influencerId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ai-influencer:${influencerId}]`, msg)
    await db.update(aiInfluencers).set({
      status: 'error',
      errorMsg: msg,
      updatedAt: new Date(),
    }).where(eq(aiInfluencers.id, influencerId))
  }
}

export const aiInfluencerRoutes = new Elysia({ prefix: '/api/ai-influencer' })
  .use(authMiddleware)

  // === CREATE + GENERATE ===
  .post('/', async ({ body, user }) => {
    const faceRefPath = body.face_ref ? await saveUpload(body.face_ref, 'face') : null
    const styleRefPath = body.style_ref ? await saveUpload(body.style_ref, 'style') : null
    const niches = (body.niches ?? '').split('|').filter(Boolean)
    const aestheticVibe = body.aesthetic_vibe || null

    const spec: InfluencerSpec = {
      name: body.name,
      gender: body.gender as 'female' | 'male',
      age: Number(body.age),
      niches,
      backstory: body.backstory ?? '',
      personality: Number(body.personality),
      ethnicity: body.ethnicity,
      skinTone: body.skin_tone,
      hairColor: body.hair_color,
      hairLength: body.hair_length,
      hairTexture: body.hair_texture,
      eyeColor: body.eye_color,
      build: body.build,
      customDescription: body.custom_description ?? '',
      aestheticVibe,
      hasFaceRef: !!faceRefPath,
      hasStyleRef: !!styleRefPath,
    }

    const imagePrompt = buildInfluencerImagePrompt(spec)

    const [influencer] = await db.insert(aiInfluencers).values({
      userId: user.id,
      name: spec.name,
      gender: spec.gender,
      age: spec.age,
      niches: niches.join('|'),
      faceRefPath,
      styleRefPath,
      backstory: spec.backstory,
      personality: spec.personality,
      ethnicity: spec.ethnicity,
      skinTone: spec.skinTone,
      hairColor: spec.hairColor,
      hairLength: spec.hairLength,
      hairTexture: spec.hairTexture,
      eyeColor: spec.eyeColor,
      build: spec.build,
      customDescription: spec.customDescription,
      aestheticVibe,
      imagePrompt,
      status: 'queued',
    }).returning()

    generateInfluencerImage(influencer.id).catch((err) =>
      console.error('[ai-influencer:bg]', err)
    )

    return { ok: true, influencer }
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 100 }),
      gender: t.Union([t.Literal('female'), t.Literal('male')]),
      age: t.String(),
      niches: t.Optional(t.String()),  // pipe-separated
      face_ref: t.Optional(t.File()),
      style_ref: t.Optional(t.File()),
      backstory: t.Optional(t.String({ maxLength: 2000 })),
      personality: t.String(),
      ethnicity: t.String(),
      skin_tone: t.String(),
      hair_color: t.String(),
      hair_length: t.String(),
      hair_texture: t.String(),
      eye_color: t.String(),
      build: t.String(),
      custom_description: t.Optional(t.String({ maxLength: 500 })),
      aesthetic_vibe: t.Optional(t.String()),
    }),
  })

  // === LIST ===
  .get('/', async ({ user }) => {
    const list = await db.query.aiInfluencers.findMany({
      where: eq(aiInfluencers.userId, user.id),
      orderBy: [desc(aiInfluencers.createdAt)],
    })
    return { influencers: list }
  })

  // === DETAIL ===
  .get('/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const inf = await db.query.aiInfluencers.findFirst({
      where: and(eq(aiInfluencers.id, id), eq(aiInfluencers.userId, user.id)),
    })
    if (!inf) {
      set.status = 404
      return { error: 'Influencer tidak ditemukan' }
    }
    return { influencer: inf }
  })

  // === REGENERATE (with optional instruction) ===
  // Rebuilds the prompt from the persisted spec so improvements to the prompt
  // builder (e.g. safety-filter fixes) apply on every regen.
  .post('/:id/regenerate', async ({ params, body, user, set }) => {
    const id = Number(params.id)
    const inf = await db.query.aiInfluencers.findFirst({
      where: and(eq(aiInfluencers.id, id), eq(aiInfluencers.userId, user.id)),
    })
    if (!inf) {
      set.status = 404
      return { error: 'Not found' }
    }

    const spec: InfluencerSpec = {
      name: inf.name,
      gender: inf.gender as 'female' | 'male',
      age: inf.age,
      niches: inf.niches.split('|').filter(Boolean),
      backstory: inf.backstory,
      personality: inf.personality,
      ethnicity: inf.ethnicity,
      skinTone: inf.skinTone,
      hairColor: inf.hairColor,
      hairLength: inf.hairLength,
      hairTexture: inf.hairTexture,
      eyeColor: inf.eyeColor,
      build: inf.build,
      customDescription: inf.customDescription,
      aestheticVibe: inf.aestheticVibe,
      hasFaceRef: !!inf.faceRefPath,
      hasStyleRef: !!inf.styleRefPath,
    }
    const fresh = buildInfluencerImagePrompt(spec)
    const instruction = body.instruction?.trim() ?? ''
    const newPrompt = instruction ? `${fresh}\n\nADJUSTMENT: ${instruction}` : fresh

    await db.update(aiInfluencers).set({
      imagePrompt: newPrompt,
      status: 'queued',
      imageUrl: null,
      imagePath: null,
      imageGeminigenUuid: null,
      errorMsg: null,
      updatedAt: new Date(),
    }).where(eq(aiInfluencers.id, id))

    generateInfluencerImage(id).catch((err) => console.error('[ai-influencer:bg]', err))
    return { ok: true }
  }, {
    body: t.Object({
      instruction: t.Optional(t.String({ maxLength: 1000 })),
    }),
  })

  // === DELETE ===
  .delete('/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const existing = await db.query.aiInfluencers.findFirst({
      where: and(eq(aiInfluencers.id, id), eq(aiInfluencers.userId, user.id)),
    })
    if (!existing) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.delete(aiInfluencers).where(eq(aiInfluencers.id, id))
    return { ok: true }
  })

// Recovery helper
export async function recoverPendingInfluencers() {
  const pending = await db.query.aiInfluencers.findMany({
    where: (i, { or, eq }) => or(eq(i.status, 'queued'), eq(i.status, 'processing')),
  })
  for (const i of pending) {
    console.log(`[ai-influencer] Recovering #${i.id}`)
    generateInfluencerImage(i.id).catch((err) => console.error('[ai-influencer]', err))
  }
}
