import { Elysia, t } from 'elysia'
import { google } from 'googleapis'
import { mkdir, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.WORKER_PORT ?? 3001)
const API_KEY = process.env.WORKER_API_KEY ?? ''
const TMP_DIR = process.env.WORKER_TMP_DIR || '/tmp/ytcrm-worker'

await mkdir(TMP_DIR, { recursive: true })

if (!API_KEY) {
  console.warn('⚠️  WORKER_API_KEY not set — worker is open!')
}

async function saveTempFile(file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = join(TMP_DIR, name)
  await Bun.write(path, file)
  return path
}

const app = new Elysia()
  .get('/', () => ({ name: 'ytcrm-worker', status: 'ok' }))
  .get('/health', ({ headers, set }) => {
    if (API_KEY && headers['x-api-key'] !== API_KEY) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
    return { ok: true, ts: Date.now() }
  })
  .post(
    '/upload',
    async ({ body, headers, set }) => {
      if (API_KEY && headers['x-api-key'] !== API_KEY) {
        set.status = 401
        return { ok: false, error: 'Unauthorized' }
      }

      let videoPath: string | null = null
      let thumbPath: string | null = null

      try {
        videoPath = await saveTempFile(body.video, 'video')
        thumbPath = body.thumbnail ? await saveTempFile(body.thumbnail, 'thumb') : null

        const oauth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        )
        oauth.setCredentials({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
        })
        const youtube = google.youtube({ version: 'v3', auth: oauth })

        const tags = (body.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)

        console.log(`[upload] Starting: "${body.title}" (${(body.video.size / 1024 / 1024).toFixed(1)} MB)`)

        const result = await youtube.videos.insert({
          part: ['snippet', 'status'],
          requestBody: {
            snippet: {
              title: body.title,
              description: body.description ?? '',
              tags,
              categoryId: body.category_id,
              defaultLanguage: body.language,
              defaultAudioLanguage: body.language,
            },
            status: {
              privacyStatus: body.privacy as 'public' | 'private' | 'unlisted',
              selfDeclaredMadeForKids: body.made_for_kids === 'true',
            },
          },
          media: { body: createReadStream(videoPath) },
        })

        const videoId = result.data.id
        if (!videoId) throw new Error('No video ID returned from YouTube')

        if (thumbPath) {
          try {
            await youtube.thumbnails.set({
              videoId,
              media: { body: createReadStream(thumbPath) },
            })
          } catch (err) {
            console.warn('[upload] Thumbnail upload failed:', err)
          }
        }

        console.log(`[upload] Done: ${videoId}`)

        return {
          ok: true,
          videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[upload] Error:', msg)
        set.status = 500
        return { ok: false, error: msg }
      } finally {
        if (videoPath) await unlink(videoPath).catch(() => {})
        if (thumbPath) await unlink(thumbPath).catch(() => {})
      }
    },
    {
      body: t.Object({
        video: t.File(),
        thumbnail: t.Optional(t.File()),
        title: t.String({ minLength: 1, maxLength: 200 }),
        description: t.Optional(t.String()),
        tags: t.Optional(t.String()),
        category_id: t.String(),
        privacy: t.String(),
        language: t.String(),
        made_for_kids: t.String(),
        access_token: t.String(),
        refresh_token: t.Optional(t.String()),
      }),
    }
  )
  .onError(({ error, set }) => {
    console.error('[worker error]', error)
    set.status = set.status === 200 ? 500 : set.status
    return { ok: false, error: error instanceof Error ? error.message : 'Internal error' }
  })
  .listen(PORT)

console.log(`🚀 Worker listening on http://localhost:${PORT}`)

export type Worker = typeof app
