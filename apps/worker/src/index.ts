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

function buildYouTube(accessToken: string, refreshToken?: string) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth.setCredentials({ access_token: accessToken, refresh_token: refreshToken })
  return google.youtube({ version: 'v3', auth: oauth })
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
  .onBeforeHandle(({ headers, path, set }) => {
    // Auth check buat semua endpoint kecuali "/" dan "/health"
    if (path === '/' || path === '/health') return
    if (API_KEY && headers['x-api-key'] !== API_KEY) {
      set.status = 401
      return { ok: false, error: 'Unauthorized' }
    }
  })
  .post(
    '/upload',
    async ({ body, set }) => {
      let videoPath: string | null = null
      let thumbPath: string | null = null

      try {
        videoPath = await saveTempFile(body.video, 'video')
        thumbPath = body.thumbnail ? await saveTempFile(body.thumbnail, 'thumb') : null

        const youtube = buildYouTube(body.access_token, body.refresh_token)
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
              // Scheduled publish requires the video to start private; YouTube
              // flips it to public automatically at publishAt.
              privacyStatus: body.publish_at
                ? 'private'
                : (body.privacy as 'public' | 'private' | 'unlisted'),
              selfDeclaredMadeForKids: body.made_for_kids === 'true',
              ...(body.publish_at ? { publishAt: body.publish_at } : {}),
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
        publish_at: t.Optional(t.String()),  // RFC3339 — schedule auto-publish on YouTube
        access_token: t.String(),
        refresh_token: t.Optional(t.String()),
      }),
    }
  )
  // Update metadata video yang sudah di-upload
  .post(
    '/update-metadata',
    async ({ body, set }) => {
      try {
        const youtube = buildYouTube(body.access_token, body.refresh_token)
        const tags = (body.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)

        const result = await youtube.videos.update({
          part: ['snippet', 'status'],
          requestBody: {
            id: body.video_id,
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
        })

        console.log(`[update-metadata] ${body.video_id}: success`)
        return { ok: true, videoId: result.data.id }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[update-metadata] Error:', msg)
        set.status = 500
        return { ok: false, error: msg }
      }
    },
    {
      body: t.Object({
        video_id: t.String(),
        title: t.String(),
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
  // Tarik stats (views, likes, comments) untuk batch video IDs
  .post(
    '/get-stats',
    async ({ body, set }) => {
      try {
        const youtube = buildYouTube(body.access_token, body.refresh_token)
        const ids = body.video_ids.split(',').map(s => s.trim()).filter(Boolean)
        if (ids.length === 0) return { ok: true, stats: [] }

        // YouTube API max 50 IDs per call
        const chunks: string[][] = []
        for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50))

        const allStats: Array<{
          videoId: string
          viewCount: number
          likeCount: number
          commentCount: number
        }> = []

        for (const chunk of chunks) {
          const { data } = await youtube.videos.list({
            part: ['statistics'],
            id: chunk,
          })
          for (const item of data.items ?? []) {
            allStats.push({
              videoId: item.id ?? '',
              viewCount: Number(item.statistics?.viewCount ?? 0),
              likeCount: Number(item.statistics?.likeCount ?? 0),
              commentCount: Number(item.statistics?.commentCount ?? 0),
            })
          }
        }

        return { ok: true, stats: allStats }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[get-stats] Error:', msg)
        set.status = 500
        return { ok: false, error: msg }
      }
    },
    {
      body: t.Object({
        video_ids: t.String(), // comma-separated
        access_token: t.String(),
        refresh_token: t.Optional(t.String()),
      }),
    }
  )
  // Hapus video di YouTube
  .post(
    '/delete-video',
    async ({ body, set }) => {
      try {
        const youtube = buildYouTube(body.access_token, body.refresh_token)
        await youtube.videos.delete({ id: body.video_id })
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        set.status = 500
        return { ok: false, error: msg }
      }
    },
    {
      body: t.Object({
        video_id: t.String(),
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
  .listen({
    port: PORT,
    hostname: '0.0.0.0',
    maxRequestBodySize: 2 * 1024 * 1024 * 1024,
    idleTimeout: 0,
  })

console.log(`🚀 Worker listening on http://0.0.0.0:${PORT}`)

export type Worker = typeof app
