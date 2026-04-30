export interface User {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  createdAt?: string
}

export interface YoutubeAccount {
  id: number
  email: string
  name: string | null
  avatarUrl: string | null
  channelTitle: string | null
  channelId: string | null
  createdAt: string
}

export type VideoStatus = 'queued' | 'uploading' | 'done' | 'error' | 'scheduled'
export type VideoPrivacy = 'public' | 'private' | 'unlisted'

export interface Video {
  id: number
  userId: number
  youtubeAccountId: number | null
  youtubeAccount?: Pick<YoutubeAccount, 'id' | 'email' | 'name' | 'avatarUrl' | 'channelTitle'> | null
  title: string
  description: string
  tags: string
  categoryId: string
  privacy: VideoPrivacy
  language: string
  madeForKids: boolean
  videoPath: string
  fileName: string
  fileSize: number | null
  thumbnailPath: string | null
  status: VideoStatus
  progress: number
  youtubeId: string | null
  youtubeUrl: string | null
  errorMsg: string | null
  scheduledAt: string | null
  uploadedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface UploadLog {
  id: number
  videoId: number
  message: string
  level: 'info' | 'warn' | 'error'
  createdAt: string
}

export interface Category {
  id: string
  label: string
}
