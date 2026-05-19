// GeminiGen.AI Veo Video Generation API client
// Docs: https://docs.geminigen.ai

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const BASE_URL = 'https://api.geminigen.ai/uapi/v1'

export type VeoModel = 'veo-3.1' | 'veo-3.1-fast' | 'veo-3.1-lite' | 'veo-2'
export type VeoResolution = '720p' | '1080p'
export type VeoAspectRatio = '16:9' | '9:16'
export type VeoModeImage = 'frame' | 'ingredient'

export interface GenerateVeoParams {
  apiKey: string
  prompt: string
  model: VeoModel
  resolution?: VeoResolution
  duration?: number          // 4, 6, 8
  aspectRatio?: VeoAspectRatio
  modeImage?: VeoModeImage
  firstImagePath?: string | null
  lastImagePath?: string | null
}

export interface GenerateVeoResponse {
  id: number
  uuid: string
  user_id: number
  model_name: string
  input_text: string
  type: string
  status: number             // 1=processing, 2=completed, 3=failed
  status_desc: string
  status_percentage: number
  error_code: string
  error_message: string
  expired_at: string | null
  name: string | null
  estimated_credit: number
  media_type: string
  created_at: string
  updated_at: string | null
  delay_seconds: number
}

export interface HistoryResponse {
  id: number
  uuid: string
  user_id: number
  model_name: string
  input_text: string
  type: string
  used_credit: number
  status: number
  status_desc: string
  status_percentage: number
  error_code: string
  error_message: string
  created_at: string
  updated_at: string | null
  expired_at: string | null
  thumbnail_urls: string[] | null
  generated_video?: Array<{
    video_url: string | null
    duration: number | null
    aspect_ratio: string | null
    resolution: string | null
    status: number | null
    error_message: string | null
    has_watermark: number | null
  }>
  generated_image?: unknown[]
  generated_audio?: unknown[]
  reference_item?: unknown[]
}

// Wrapper Error untuk distinguishing API errors
export class GeminigenError extends Error {
  status?: number
  code?: string
  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'GeminigenError'
    this.status = status
    this.code = code
  }
}

async function appendFileToForm(form: FormData, fieldName: string, path: string) {
  const buffer = await readFile(path)
  const filename = basename(path)
  // Detect mime by extension (simple)
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const mime: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif',
  }
  const blob = new Blob([buffer], { type: mime[ext] ?? 'application/octet-stream' })
  form.append(fieldName, blob, filename)
}

export async function generateVeo(params: GenerateVeoParams): Promise<GenerateVeoResponse> {
  const form = new FormData()
  form.append('prompt', params.prompt)
  form.append('model', params.model)
  if (params.resolution) form.append('resolution', params.resolution)
  if (params.duration) form.append('duration', String(params.duration))
  if (params.aspectRatio) form.append('aspect_ratio', params.aspectRatio)
  form.append('mode_image', params.modeImage ?? 'frame')

  // ref_images: first image dulu, lalu last image (sesuai docs)
  if (params.firstImagePath) {
    await appendFileToForm(form, 'ref_images', params.firstImagePath)
  }
  if (params.lastImagePath) {
    await appendFileToForm(form, 'ref_images', params.lastImagePath)
  }

  const res = await fetch(`${BASE_URL}/video-gen/veo`, {
    method: 'POST',
    headers: { 'x-api-key': params.apiKey },
    body: form,
  })

  const data = await res.json().catch(() => null) as
    | GenerateVeoResponse
    | { detail?: { error_code?: string; error_message?: string } }
    | null

  if (!res.ok || !data || 'detail' in data) {
    const errMsg = data && 'detail' in data
      ? (data.detail?.error_message ?? `HTTP ${res.status}`)
      : `HTTP ${res.status}`
    const errCode = data && 'detail' in data ? data.detail?.error_code : undefined
    throw new GeminigenError(errMsg, res.status, errCode)
  }

  return data as GenerateVeoResponse
}

export async function getHistory(uuid: string, apiKey: string): Promise<HistoryResponse> {
  const res = await fetch(`${BASE_URL}/history/${uuid}`, {
    headers: { 'x-api-key': apiKey },
  })

  const data = await res.json().catch(() => null) as
    | HistoryResponse
    | { detail?: { error_code?: string; error_message?: string } }
    | null

  if (!res.ok || !data || 'detail' in data) {
    const errMsg = data && 'detail' in data
      ? (data.detail?.error_message ?? `HTTP ${res.status}`)
      : `HTTP ${res.status}`
    const errCode = data && 'detail' in data ? data.detail?.error_code : undefined
    throw new GeminigenError(errMsg, res.status, errCode)
  }

  return data as HistoryResponse
}

// Helper: check if a status is terminal
export function isTerminalStatus(status: number): boolean {
  return status === 2 || status === 3
}
