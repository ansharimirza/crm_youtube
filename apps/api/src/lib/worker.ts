// Client untuk forward upload ke Worker (VPS US)

const WORKER_URL = process.env.WORKER_URL || 'http://worker:3001'
const WORKER_API_KEY = process.env.WORKER_API_KEY || ''

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

export interface WorkerUploadResult {
  ok: true
  videoId: string
  url: string
}

export interface WorkerError {
  ok: false
  error: string
}

export async function uploadViaWorker(params: WorkerUploadParams): Promise<WorkerUploadResult | WorkerError> {
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
    headers: { 'x-api-key': WORKER_API_KEY },
    body: form,
  })

  return await res.json() as WorkerUploadResult | WorkerError
}

export async function workerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      headers: { 'x-api-key': WORKER_API_KEY },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}
