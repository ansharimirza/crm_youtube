// Client untuk forward request ke Worker (VPS US)

const WORKER_URL = process.env.WORKER_URL || 'http://worker:3001'
const WORKER_API_KEY = process.env.WORKER_API_KEY || ''

const headers = () => ({ 'x-api-key': WORKER_API_KEY })

export interface WorkerUploadParams {
  videoPath: string
  thumbnailPath?: string | null
  title: string
  description: string
  tags: string[]
  categoryId: string
  privacy: 'public' | 'private' | 'unlisted'
  language: string
  madeForKids: boolean
  accessToken: string
  refreshToken: string | null
}

export type WorkerResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string }

export async function uploadViaWorker(
  params: WorkerUploadParams
): Promise<WorkerResult<{ videoId: string; url: string }>> {
  const form = new FormData()

  const videoFile = Bun.file(params.videoPath)
  form.append('video', videoFile, params.videoPath.split('/').pop())

  if (params.thumbnailPath) {
    const thumbFile = Bun.file(params.thumbnailPath)
    form.append('thumbnail', thumbFile, params.thumbnailPath.split('/').pop())
  }

  form.append('title', params.title)
  form.append('description', params.description)
  form.append('tags', params.tags.join(','))
  form.append('category_id', params.categoryId)
  form.append('privacy', params.privacy)
  form.append('language', params.language)
  form.append('made_for_kids', String(params.madeForKids))
  form.append('access_token', params.accessToken)
  if (params.refreshToken) form.append('refresh_token', params.refreshToken)

  const res = await fetch(`${WORKER_URL}/upload`, {
    method: 'POST',
    headers: headers(),
    body: form,
  })

  return await res.json() as WorkerResult<{ videoId: string; url: string }>
}

export interface WorkerUpdateParams {
  videoId: string
  title: string
  description: string
  tags: string[]
  categoryId: string
  privacy: 'public' | 'private' | 'unlisted'
  language: string
  madeForKids: boolean
  accessToken: string
  refreshToken: string | null
}

export async function updateMetadataViaWorker(
  params: WorkerUpdateParams
): Promise<WorkerResult<{ videoId: string }>> {
  const res = await fetch(`${WORKER_URL}/update-metadata`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_id: params.videoId,
      title: params.title,
      description: params.description,
      tags: params.tags.join(','),
      category_id: params.categoryId,
      privacy: params.privacy,
      language: params.language,
      made_for_kids: String(params.madeForKids),
      access_token: params.accessToken,
      ...(params.refreshToken ? { refresh_token: params.refreshToken } : {}),
    }),
  })

  return await res.json() as WorkerResult<{ videoId: string }>
}

export interface VideoStats {
  videoId: string
  viewCount: number
  likeCount: number
  commentCount: number
}

export async function getStatsViaWorker(params: {
  videoIds: string[]
  accessToken: string
  refreshToken: string | null
}): Promise<WorkerResult<{ stats: VideoStats[] }>> {
  const res = await fetch(`${WORKER_URL}/get-stats`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_ids: params.videoIds.join(','),
      access_token: params.accessToken,
      ...(params.refreshToken ? { refresh_token: params.refreshToken } : {}),
    }),
  })

  return await res.json() as WorkerResult<{ stats: VideoStats[] }>
}

export async function deleteVideoViaWorker(params: {
  videoId: string
  accessToken: string
  refreshToken: string | null
}): Promise<WorkerResult> {
  const res = await fetch(`${WORKER_URL}/delete-video`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_id: params.videoId,
      access_token: params.accessToken,
      ...(params.refreshToken ? { refresh_token: params.refreshToken } : {}),
    }),
  })

  return await res.json() as WorkerResult
}

export async function workerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      headers: headers(),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}
