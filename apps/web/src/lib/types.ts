export interface User {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  isActive?: boolean
  hasGeminigenKey?: boolean
  hasGeminiKey?: boolean
  createdAt?: string
  videoCount?: number
  channelCount?: number
}

export interface VeoProjectSummary {
  id: number
  title: string
  description: string
  createdAt: string
  updatedAt: string
  sceneCount: number
  doneCount: number
  errorCount: number
  processingCount: number
  thumbnail: string | null
}

export interface VeoProject {
  id: number
  userId: number
  title: string
  description: string
  createdAt: string
  updatedAt: string
  scenes: VeoScene[]
}

export type VeoModel = 'veo-3.1' | 'veo-3.1-fast' | 'veo-3.1-lite' | 'veo-2'
export type VeoResolution = '720p' | '1080p'
export type VeoAspectRatio = '16:9' | '9:16'
export type VeoSceneStatus = 'queued' | 'processing' | 'done' | 'error'

export interface VeoScene {
  id: number
  projectId: number
  sceneNumber: number
  prompt: string
  imagePrompt: string | null
  model: VeoModel
  resolution: VeoResolution
  aspectRatio: VeoAspectRatio
  duration: number
  modeImage: 'frame' | 'ingredient'
  firstImagePath: string | null
  lastImagePath: string | null
  status: VeoSceneStatus
  progress: number
  attempts: number
  geminigenUuid: string | null
  geminigenId: number | null
  videoUrl: string | null
  thumbnailUrl: string | null
  hasWatermark: number
  errorMsg: string | null
  createdAt: string
  updatedAt: string
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
  attempts: number
  lastAttemptAt: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  statsUpdatedAt: string | null
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

export interface Notification {
  id: number
  userId: number
  videoId: number | null
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
}

export interface Category {
  id: string
  label: string
}

export interface AnalyzedScene {
  scene_number: number
  start_time: string
  end_time: string
  duration_suggested: number
  veo_model_suggested: 'veo-2' | 'veo-3.1' | 'veo-3.1-fast' | 'veo-3.1-lite'
  image_prompt: string
  video_prompt: string
  mood: string
}

export interface AnalyzeResult {
  summary: string
  scenes: AnalyzedScene[]
}

export type ViralityEmotion = 'Kagum' | 'Lucu' | 'Edukasi' | 'Marah'

export interface ViralityCriterion {
  score: number
  analysis: string
}

export interface ViralityResult {
  total_score: number
  visual_audio_hook: ViralityCriterion
  pacing_retention: ViralityCriterion
  shareability: ViralityCriterion
  critical_seconds_analysis: string
  cut_recommendation: string
  predicted_emotion: ViralityEmotion
  summary: string
}
