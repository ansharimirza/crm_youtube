import { pgTable, serial, text, timestamp, integer, boolean, varchar, real } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Akun aplikasi (login email/password)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 16, enum: ['admin', 'user'] }).default('user').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  geminigenApiKey: text('geminigen_api_key'),
  geminiApiKey: text('gemini_api_key'),
  anthropicApiKey: text('anthropic_api_key'),
  mcpApiKey: text('mcp_api_key'), // token for the MCP connector (Claude Desktop)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Veo Studio: project = judul, berisi banyak scene
export const veoProjects = pgTable('veo_projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').default('').notNull(),
  // Faceless-video auto-edit (assemble scene clips + narration -> final MP4)
  // mode/voiceMode stored so recovery + retry use the right pipeline (not inference).
  facelessMode: varchar('faceless_mode', { length: 16 }), // 'veo' | 'kenburns' | 'static'
  facelessVoiceMode: varchar('faceless_voice_mode', { length: 16 }), // 'tts' | 'upload' | 'single'
  // Image source for generated scenes: 'geminigen' (Nano Banana, paid) | 'pollinations' (free).
  // Stored so retry/recover regenerate with the same provider.
  imageProvider: varchar('image_provider', { length: 16 }).default('geminigen'),
  musicPath: text('music_path'),
  // Full-narration mode: one uploaded voiceover for the whole video (scenes spread across it)
  narrationFullPath: text('narration_full_path'),
  narrationFullDuration: real('narration_full_duration'),
  thumbnailPath: text('thumbnail_path'),
  finalVideoPath: text('final_video_path'),
  finalVideoUrl: text('final_video_url'),
  assembleStatus: varchar('assemble_status', { length: 16, enum: ['idle', 'queued', 'rendering', 'done', 'error'] }).default('idle').notNull(),
  assembleError: text('assemble_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const veoScenes = pgTable('veo_scenes', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').references(() => veoProjects.id, { onDelete: 'cascade' }).notNull(),
  sceneNumber: integer('scene_number').notNull(),
  // Input
  prompt: text('prompt').notNull(),
  imagePrompt: text('image_prompt'),
  // plain varchar — also stores grok-3 / kling-* (see scene-worker)
  model: varchar('model', { length: 32 }).default('veo-2').notNull(),
  aspectRatio: varchar('aspect_ratio', { length: 8, enum: ['16:9', '9:16'] }).default('16:9').notNull(),
  resolution: varchar('resolution', { length: 8, enum: ['720p', '1080p'] }).default('720p').notNull(),
  duration: integer('duration').default(4).notNull(),
  modeImage: varchar('mode_image', { length: 16, enum: ['frame', 'ingredient'] }).default('frame').notNull(),
  firstImagePath: text('first_image_path'),
  lastImagePath: text('last_image_path'),
  // For Kling motion-control models — reference video driving the motion
  referenceVideoPath: text('reference_video_path'),
  // State
  status: varchar('status', { length: 16, enum: ['queued', 'processing', 'done', 'error'] }).default('queued').notNull(),
  progress: integer('progress').default(0).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  geminigenUuid: varchar('geminigen_uuid', { length: 64 }),
  geminigenId: integer('geminigen_id'),
  videoUrl: text('video_url'),
  thumbnailUrl: text('thumbnail_url'),
  hasWatermark: integer('has_watermark').default(0).notNull(),
  errorMsg: text('error_msg'),
  // Faceless narration (voiceover spoken during this scene)
  narrationText: text('narration_text').default('').notNull(),
  narrationAudioPath: text('narration_audio_path'),
  narrationDuration: real('narration_duration'), // exact seconds from TTS (or uploaded audio)
  alignedDuration: real('aligned_duration'), // exact screen-time from forced-alignment of full narration
  noZoom: boolean('no_zoom').default(false).notNull(), // static image mode (no Ken Burns pan/zoom)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Vertical Short clips cut from a project's final video (AI-picked hook segment, 9:16).
export const veoShorts = pgTable('veo_shorts', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').references(() => veoProjects.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 200 }).default('').notNull(),
  startSec: real('start_sec').notNull(),
  endSec: real('end_sec').notNull(),
  path: text('path'),
  status: varchar('status', { length: 16, enum: ['rendering', 'done', 'error'] }).default('rendering').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Clipper: take a source video (uploaded) + campaign requirements, AI-pick segments that
// satisfy the rules, cut them into vertical clips. Standalone (not tied to veo projects).
export const clipJobs = pgTable('clip_jobs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 200 }).default('').notNull(),
  sourceVideoPath: text('source_video_path'),
  sourceUrl: text('source_url'), // YouTube link (downloaded via yt-dlp before processing)
  requirements: text('requirements').default('').notNull(), // campaign rules (varies per campaign)
  clipCount: integer('clip_count').default(3).notNull(),
  aspectRatio: varchar('aspect_ratio', { length: 8 }).default('9:16').notNull(),
  status: varchar('status', { length: 16, enum: ['queued', 'downloading', 'transcribing', 'selecting', 'rendering', 'done', 'error'] }).default('queued').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const clips = pgTable('clips', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').references(() => clipJobs.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 200 }).default('').notNull(),
  startSec: real('start_sec').notNull(),
  endSec: real('end_sec').notNull(),
  reason: text('reason').default('').notNull(),
  path: text('path'),
  status: varchar('status', { length: 16, enum: ['rendering', 'done', 'error'] }).default('rendering').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Notifikasi untuk user (in-app)
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  videoId: integer('video_id').references(() => videos.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Akun YouTube yang di-connect ke 1 user (1 user bisa banyak channel)
export const youtubeAccounts = pgTable('youtube_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  googleId: varchar('google_id', { length: 64 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  channelTitle: varchar('channel_title', { length: 255 }),
  channelId: varchar('channel_id', { length: 64 }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenExpiry: timestamp('token_expiry', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const videos = pgTable('videos', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  youtubeAccountId: integer('youtube_account_id').references(() => youtubeAccounts.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').default('').notNull(),
  tags: text('tags').default('').notNull(),
  categoryId: varchar('category_id', { length: 8 }).default('22').notNull(),
  privacy: varchar('privacy', { length: 16, enum: ['public', 'private', 'unlisted'] }).default('public').notNull(),
  language: varchar('language', { length: 8 }).default('en').notNull(),
  madeForKids: boolean('made_for_kids').default(false).notNull(),
  videoPath: text('video_path').notNull(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileSize: integer('file_size'),
  thumbnailPath: text('thumbnail_path'),
  status: varchar('status', { length: 16, enum: ['queued', 'uploading', 'done', 'error', 'scheduled'] }).default('queued').notNull(),
  progress: integer('progress').default(0).notNull(),
  youtubeId: varchar('youtube_id', { length: 32 }),
  youtubeUrl: text('youtube_url'),
  errorMsg: text('error_msg'),
  attempts: integer('attempts').default(0).notNull(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  // Stats yang ditarik dari YouTube
  viewCount: integer('view_count').default(0).notNull(),
  likeCount: integer('like_count').default(0).notNull(),
  commentCount: integer('comment_count').default(0).notNull(),
  statsUpdatedAt: timestamp('stats_updated_at', { withTimezone: true }),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// TikTok Studio: campaign berisi banyak scene
export const tiktokCampaigns = pgTable('tiktok_campaigns', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  mode: varchar('mode', { length: 32, enum: ['ugc', 'pov_hand', 'mirror_check'] }).notNull(),
  contentType: varchar('content_type', { length: 32, enum: ['review', 'unboxing', 'affiliate'] }).notNull(),
  language: varchar('language', { length: 8, enum: ['id', 'en'] }).default('id').notNull(),
  // Inputs
  baseModelPath: text('base_model_path'),     // image of person (UGC mode)
  productImagePath: text('product_image_path'),
  productUrl: text('product_url'),
  productName: varchar('product_name', { length: 255 }).notNull(),
  productDescription: text('product_description').default('').notNull(),
  // Settings
  environment: text('environment').notNull(),
  aspectRatio: varchar('aspect_ratio', { length: 8, enum: ['16:9', '9:16', '1:1'] }).default('9:16').notNull(),
  resolution: varchar('resolution', { length: 8, enum: ['720p', '1080p'] }).default('1080p').notNull(),
  // Video model name — Veo (veo-2, veo-3.1, veo-3.1-fast, veo-3.1-lite) or Grok (grok-3)
  veoModel: varchar('veo_model', { length: 32 }).default('veo-2').notNull(),
  sceneCount: integer('scene_count').default(4).notNull(),
  // State — 'draft' = script generated, awaiting user approval to start image gen;
  //         'generating_images' = phase 1; 'images_done' = ready for video; 'generating_videos' = phase 2; 'done'/'error'
  status: varchar('status', { length: 24, enum: ['draft', 'generating_images', 'images_done', 'generating_videos', 'done', 'error'] }).default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Frames — shared across scenes. For N scenes, there are N+1 frames where
// scene[i].endFrameId === scene[i+1].startFrameId (same physical frame).
export const tiktokFrames = pgTable('tiktok_frames', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').references(() => tiktokCampaigns.id, { onDelete: 'cascade' }).notNull(),
  frameNumber: integer('frame_number').notNull(), // 0-indexed within campaign
  imagePrompt: text('image_prompt').default('').notNull(),
  status: varchar('status', { length: 16, enum: ['draft', 'queued', 'processing', 'done', 'error'] }).default('draft').notNull(),
  imageUrl: text('image_url'),
  imagePath: text('image_path'),
  geminigenUuid: varchar('geminigen_uuid', { length: 64 }),
  attempts: integer('attempts').default(0).notNull(),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const tiktokScenes = pgTable('tiktok_scenes', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').references(() => tiktokCampaigns.id, { onDelete: 'cascade' }).notNull(),
  sceneNumber: integer('scene_number').notNull(),
  // Script (from Claude — editable in review)
  script: text('script').notNull(),
  veoPrompt: text('veo_prompt').notNull(),
  duration: integer('duration').default(8).notNull(),
  // References to shared frames
  startFrameId: integer('start_frame_id').references(() => tiktokFrames.id, { onDelete: 'set null' }),
  endFrameId: integer('end_frame_id').references(() => tiktokFrames.id, { onDelete: 'set null' }),
  // Video generation
  status: varchar('status', { length: 16, enum: ['pending', 'queued', 'processing', 'done', 'error'] }).default('pending').notNull(),
  progress: integer('progress').default(0).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  geminigenUuid: varchar('geminigen_uuid', { length: 64 }),
  geminigenId: integer('geminigen_id'),
  videoUrl: text('video_url'),
  thumbnailUrl: text('thumbnail_url'),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Motion Studio — Kling motion control (character image + reference video → animated clip)
export const motionVideos = pgTable('motion_videos', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 200 }).default('').notNull(),
  // Inputs
  characterImagePath: text('character_image_path').notNull(),
  referenceVideoPath: text('reference_video_path').notNull(),
  prompt: text('prompt').default('').notNull(),
  // Settings — duration is auto-derived from the reference video by Kling,
  // resolution maps to mode (standard=720p, professional=1080p)
  aspectRatio: varchar('aspect_ratio', { length: 8, enum: ['16:9', '9:16', '1:1'] }).default('9:16').notNull(),
  resolution: varchar('resolution', { length: 8, enum: ['720p', '1080p'] }).default('720p').notNull(),
  model: varchar('model', { length: 32 }).default('kling-video-motion-3').notNull(),
  // Result
  status: varchar('status', { length: 16, enum: ['queued', 'processing', 'done', 'error'] }).default('queued').notNull(),
  progress: integer('progress').default(0).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  geminigenUuid: varchar('geminigen_uuid', { length: 64 }),
  videoUrl: text('video_url'),
  thumbnailUrl: text('thumbnail_url'),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const motionVideosRelations = relations(motionVideos, ({ one }) => ({
  user: one(users, { fields: [motionVideos.userId], references: [users.id] }),
}))

// AI Influencer — persona builder + Nano Banana image generation
export const aiInfluencers = pgTable('ai_influencers', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  // Step 1: basics
  name: varchar('name', { length: 100 }).notNull(),
  gender: varchar('gender', { length: 16, enum: ['female', 'male'] }).notNull(),
  age: integer('age').notNull(),
  niches: text('niches').default('').notNull(), // pipe-separated
  // Step 2: references
  faceRefPath: text('face_ref_path'),
  styleRefPath: text('style_ref_path'),
  // Step 3: persona
  backstory: text('backstory').default('').notNull(),
  personality: integer('personality').default(50).notNull(), // 0 = introvert, 100 = extrovert
  // Step 4: looks
  ethnicity: varchar('ethnicity', { length: 32 }).notNull(),
  skinTone: varchar('skin_tone', { length: 16 }).notNull(),
  hairColor: varchar('hair_color', { length: 16 }).notNull(),
  hairLength: varchar('hair_length', { length: 16 }).notNull(),
  hairTexture: varchar('hair_texture', { length: 16 }).notNull(),
  eyeColor: varchar('eye_color', { length: 16 }).notNull(),
  build: varchar('build', { length: 16 }).notNull(),
  customDescription: text('custom_description').default('').notNull(),
  aestheticVibe: varchar('aesthetic_vibe', { length: 24 }),
  // Generation results
  imagePrompt: text('image_prompt').default('').notNull(),
  imageUrl: text('image_url'),
  imagePath: text('image_path'),
  imageGeminigenUuid: varchar('image_geminigen_uuid', { length: 64 }),
  status: varchar('status', { length: 16, enum: ['queued', 'processing', 'done', 'error'] }).default('queued').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Variants: same character, different outfit / background / pose. The parent
// influencer's generated image is used as the identity reference, optionally
// combined with a user-supplied reference image (outfit or scene inspo).
export const aiInfluencerVariants = pgTable('ai_influencer_variants', {
  id: serial('id').primaryKey(),
  influencerId: integer('influencer_id').references(() => aiInfluencers.id, { onDelete: 'cascade' }).notNull(),
  changeDescription: text('change_description').default('').notNull(),
  referenceImagePath: text('reference_image_path'),
  imagePrompt: text('image_prompt').default('').notNull(),
  imageUrl: text('image_url'),
  imagePath: text('image_path'),
  imageGeminigenUuid: varchar('image_geminigen_uuid', { length: 64 }),
  status: varchar('status', { length: 16, enum: ['queued', 'processing', 'done', 'error'] }).default('queued').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const aiInfluencersRelations = relations(aiInfluencers, ({ one, many }) => ({
  user: one(users, { fields: [aiInfluencers.userId], references: [users.id] }),
  variants: many(aiInfluencerVariants),
}))

export const aiInfluencerVariantsRelations = relations(aiInfluencerVariants, ({ one }) => ({
  influencer: one(aiInfluencers, { fields: [aiInfluencerVariants.influencerId], references: [aiInfluencers.id] }),
}))

export const uploadLogs = pgTable('upload_logs', {
  id: serial('id').primaryKey(),
  videoId: integer('video_id').references(() => videos.id, { onDelete: 'cascade' }).notNull(),
  message: text('message').notNull(),
  level: varchar('level', { length: 16, enum: ['info', 'warn', 'error'] }).default('info').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  videos: many(videos),
  youtubeAccounts: many(youtubeAccounts),
  veoProjects: many(veoProjects),
}))

export const veoProjectsRelations = relations(veoProjects, ({ one, many }) => ({
  user: one(users, { fields: [veoProjects.userId], references: [users.id] }),
  scenes: many(veoScenes),
  shorts: many(veoShorts),
}))

export const veoShortsRelations = relations(veoShorts, ({ one }) => ({
  project: one(veoProjects, { fields: [veoShorts.projectId], references: [veoProjects.id] }),
}))

export const clipJobsRelations = relations(clipJobs, ({ one, many }) => ({
  user: one(users, { fields: [clipJobs.userId], references: [users.id] }),
  clips: many(clips),
}))

export const clipsRelations = relations(clips, ({ one }) => ({
  job: one(clipJobs, { fields: [clips.jobId], references: [clipJobs.id] }),
}))

export const veoScenesRelations = relations(veoScenes, ({ one }) => ({
  project: one(veoProjects, { fields: [veoScenes.projectId], references: [veoProjects.id] }),
}))

export const tiktokCampaignsRelations = relations(tiktokCampaigns, ({ one, many }) => ({
  user: one(users, { fields: [tiktokCampaigns.userId], references: [users.id] }),
  scenes: many(tiktokScenes),
  frames: many(tiktokFrames),
}))

export const tiktokScenesRelations = relations(tiktokScenes, ({ one }) => ({
  campaign: one(tiktokCampaigns, { fields: [tiktokScenes.campaignId], references: [tiktokCampaigns.id] }),
  startFrame: one(tiktokFrames, { fields: [tiktokScenes.startFrameId], references: [tiktokFrames.id], relationName: 'startFrame' }),
  endFrame: one(tiktokFrames, { fields: [tiktokScenes.endFrameId], references: [tiktokFrames.id], relationName: 'endFrame' }),
}))

export const tiktokFramesRelations = relations(tiktokFrames, ({ one }) => ({
  campaign: one(tiktokCampaigns, { fields: [tiktokFrames.campaignId], references: [tiktokCampaigns.id] }),
}))

export const youtubeAccountsRelations = relations(youtubeAccounts, ({ one, many }) => ({
  user: one(users, { fields: [youtubeAccounts.userId], references: [users.id] }),
  videos: many(videos),
}))

export const videosRelations = relations(videos, ({ one, many }) => ({
  user: one(users, { fields: [videos.userId], references: [users.id] }),
  youtubeAccount: one(youtubeAccounts, { fields: [videos.youtubeAccountId], references: [youtubeAccounts.id] }),
  logs: many(uploadLogs),
}))

export const uploadLogsRelations = relations(uploadLogs, ({ one }) => ({
  video: one(videos, { fields: [uploadLogs.videoId], references: [videos.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  video: one(videos, { fields: [notifications.videoId], references: [videos.id] }),
}))

export type User = typeof users.$inferSelect
export type YoutubeAccount = typeof youtubeAccounts.$inferSelect
export type Video = typeof videos.$inferSelect
export type UploadLog = typeof uploadLogs.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type VeoProject = typeof veoProjects.$inferSelect
export type VeoScene = typeof veoScenes.$inferSelect
export type VeoShort = typeof veoShorts.$inferSelect
export type ClipJob = typeof clipJobs.$inferSelect
export type Clip = typeof clips.$inferSelect
export type TiktokCampaign = typeof tiktokCampaigns.$inferSelect
export type TiktokScene = typeof tiktokScenes.$inferSelect
export type TiktokFrame = typeof tiktokFrames.$inferSelect
export type AiInfluencer = typeof aiInfluencers.$inferSelect
export type AiInfluencerVariant = typeof aiInfluencerVariants.$inferSelect
export type MotionVideo = typeof motionVideos.$inferSelect
