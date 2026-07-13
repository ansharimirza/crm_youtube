export interface User {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  isActive?: boolean
  hasGeminigenKey?: boolean
  hasGeminiKey?: boolean
  hasAnthropicKey?: boolean
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
  // faceless assembly fields
  assembleStatus?: 'idle' | 'queued' | 'rendering' | 'done' | 'error' | null
  assembleError?: string | null
  finalVideoPath?: string | null
  finalVideoUrl?: string | null
  thumbnailPath?: string | null
  narrationFullPath?: string | null
  narrationFullDuration?: number | null
}

export type VeoModel =
  | 'veo-3.1' | 'veo-3.1-fast' | 'veo-3.1-lite' | 'veo-2'
  | 'grok-3'
  | 'kling-video-3-0' | 'kling-video-2-6' | 'kling-video-motion-3'
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
  // faceless narration fields
  narrationText?: string | null
  narrationAudioPath?: string | null
  narrationDuration?: number | null
  motion?: string | null // static | zoom | pan_left | pan_right | veo
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

export type MotionStatus = 'queued' | 'processing' | 'done' | 'error'

export interface MotionVideo {
  id: number
  userId: number
  title: string
  characterImagePath: string
  referenceVideoPath: string
  prompt: string
  aspectRatio: '16:9' | '9:16' | '1:1'
  resolution: '720p' | '1080p'
  model: string
  status: MotionStatus
  progress: number
  attempts: number
  videoUrl: string | null
  thumbnailUrl: string | null
  errorMsg: string | null
  createdAt: string
  updatedAt: string
}

export type AiInfluencerStatus = 'queued' | 'processing' | 'done' | 'error'

export interface AiInfluencerVariant {
  id: number
  influencerId: number
  changeDescription: string
  referenceImagePath: string | null
  imagePrompt: string
  imageUrl: string | null
  imagePath: string | null
  status: AiInfluencerStatus
  attempts: number
  errorMsg: string | null
  createdAt: string
  updatedAt: string
}

export interface AiInfluencer {
  id: number
  userId: number
  name: string
  gender: 'female' | 'male'
  age: number
  niches: string  // pipe-separated
  faceRefPath: string | null
  styleRefPath: string | null
  backstory: string
  personality: number
  ethnicity: string
  skinTone: string
  hairColor: string
  hairLength: string
  hairTexture: string
  eyeColor: string
  build: string
  customDescription: string
  aestheticVibe: string | null
  imagePrompt: string
  imageUrl: string | null
  imagePath: string | null
  status: AiInfluencerStatus
  attempts: number
  errorMsg: string | null
  createdAt: string
  updatedAt: string
}

export type Platform = 'tiktok' | 'reels' | 'shorts'

export type TiktokMode = 'ugc' | 'pov_hand' | 'mirror_check'
export type TiktokContentType = 'review' | 'unboxing' | 'affiliate'
export type TiktokImageStatus = 'queued' | 'processing' | 'done' | 'error'
export type TiktokSceneStatus = 'pending' | 'queued' | 'processing' | 'done' | 'error'
export type TiktokCampaignStatus =
  | 'draft'               // script generated, awaits user approval
  | 'generating_images'   // phase 1 in progress
  | 'images_done'         // phase 1 done, awaits video gen
  | 'generating_videos'   // phase 2 in progress
  | 'done'                // all videos done
  | 'error'

export interface TiktokProductInfo {
  name: string
  description: string
  category: string
  key_features: string[]
  brand: string
  detected_text?: string
}

export interface TiktokFrame {
  id: number
  campaignId: number
  frameNumber: number
  imagePrompt: string
  status: 'draft' | 'queued' | 'processing' | 'done' | 'error'
  imageUrl: string | null
  imagePath: string | null
  attempts: number
  errorMsg: string | null
  createdAt: string
  updatedAt: string
}

export interface TiktokScene {
  id: number
  campaignId: number
  sceneNumber: number
  script: string
  veoPrompt: string
  duration: number
  startFrameId: number | null
  endFrameId: number | null
  // Video phase
  status: TiktokSceneStatus
  progress: number
  attempts: number
  videoUrl: string | null
  thumbnailUrl: string | null
  errorMsg: string | null
  createdAt: string
  updatedAt: string
}

export interface TiktokCampaign {
  id: number
  userId: number
  title: string
  mode: TiktokMode
  contentType: TiktokContentType
  language: 'id' | 'en'
  productName: string
  productDescription: string
  environment: string
  aspectRatio: '9:16' | '16:9' | '1:1'
  resolution: '720p' | '1080p'
  veoModel: string
  sceneCount: number
  status: TiktokCampaignStatus
  productImagePath: string | null
  baseModelPath: string | null
  productUrl: string | null
  scenes?: TiktokScene[]
  frames?: TiktokFrame[]
  createdAt: string
  updatedAt: string
}

export interface TiktokCampaignSummary {
  id: number
  title: string
  mode: TiktokMode
  contentType: TiktokContentType
  language: 'id' | 'en'
  productName: string
  status: TiktokCampaignStatus
  sceneCount: number
  frameDoneCount: number
  frameTotal: number
  videoDoneCount: number
  processingCount: number
  errorCount: number
  thumbnail: string | null
  createdAt: string
}

export type ViralityEmotion =
  | 'Kagum' | 'Lucu' | 'Edukasi' | 'Marah'
  | 'Penasaran' | 'Inspiratif' | 'Relatable' | 'Shock'

export type HookPattern =
  | 'Bold Claim' | 'Curiosity Gap' | 'Micro-Story'
  | 'Visual Shock' | 'Direct Question' | 'None'

export interface ViralityCriterion {
  score: number
  analysis: string
  detected_signals: string[]
}

export interface SteppsItem {
  hit: boolean
  note: string
}

export interface SteppsBreakdown {
  social_currency: SteppsItem
  triggers: SteppsItem
  emotion: SteppsItem
  public: SteppsItem
  practical_value: SteppsItem
  stories: SteppsItem
}

export interface HookDiagnosis {
  pattern_detected: HookPattern
  strength_indicators: string[]
  weakness_indicators: string[]
}

export interface CutRecommendation {
  timestamp_start: string
  timestamp_end: string
  issue: string
  action: string
  reason: string
}

export interface AlternativeHook {
  pattern: HookPattern
  text: string
}

export interface CaptionResult {
  platform: Platform
  caption: string
  title?: string
  description?: string
  hashtags: string[]
  tags?: string[]
  cover_text?: string
  cta: string
  alternative_captions: string[]
}

export interface ViralityResult {
  total_score: number
  criteria: {
    hook_strength: ViralityCriterion
    pacing_retention: ViralityCriterion
    emotional_payload: ViralityCriterion
    shareability: ViralityCriterion
    platform_fit: ViralityCriterion
  }
  hook_diagnosis: HookDiagnosis
  cut_recommendations: CutRecommendation[]
  stepps_breakdown: SteppsBreakdown
  predicted_emotion: {
    primary: ViralityEmotion
    arc_description: string
  }
  predicted_completion_rate: number
  alternative_hooks: AlternativeHook[]
  summary: string
}
