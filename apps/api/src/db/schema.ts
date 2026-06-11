import { pgTable, serial, text, timestamp, integer, boolean, varchar } from 'drizzle-orm/pg-core'
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Veo Studio: project = judul, berisi banyak scene
export const veoProjects = pgTable('veo_projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').default('').notNull(),
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
  model: varchar('model', { length: 32, enum: ['veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite', 'veo-2'] }).default('veo-2').notNull(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
  // State
  status: varchar('status', { length: 16, enum: ['draft', 'generating', 'done', 'error'] }).default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const tiktokScenes = pgTable('tiktok_scenes', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').references(() => tiktokCampaigns.id, { onDelete: 'cascade' }).notNull(),
  sceneNumber: integer('scene_number').notNull(),
  // Script (from Claude)
  script: text('script').notNull(),       // VO/narration text — editable
  imagePrompt: text('image_prompt').default('').notNull(), // for Nano Banana — editable
  veoPrompt: text('veo_prompt').notNull(), // technical prompt for Veo
  duration: integer('duration').default(4).notNull(),
  // Image generation (Phase 1)
  imageStatus: varchar('image_status', { length: 16, enum: ['queued', 'processing', 'done', 'error'] }).default('queued').notNull(),
  imageUrl: text('image_url'),
  imagePath: text('image_path'),
  imageGeminigenUuid: varchar('image_geminigen_uuid', { length: 64 }),
  imageAttempts: integer('image_attempts').default(0).notNull(),
  imageErrorMsg: text('image_error_msg'),
  // Video generation (Phase 2 — kicks in when user clicks "Generate Video")
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

export const aiInfluencersRelations = relations(aiInfluencers, ({ one }) => ({
  user: one(users, { fields: [aiInfluencers.userId], references: [users.id] }),
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
}))

export const veoScenesRelations = relations(veoScenes, ({ one }) => ({
  project: one(veoProjects, { fields: [veoScenes.projectId], references: [veoProjects.id] }),
}))

export const tiktokCampaignsRelations = relations(tiktokCampaigns, ({ one, many }) => ({
  user: one(users, { fields: [tiktokCampaigns.userId], references: [users.id] }),
  scenes: many(tiktokScenes),
}))

export const tiktokScenesRelations = relations(tiktokScenes, ({ one }) => ({
  campaign: one(tiktokCampaigns, { fields: [tiktokScenes.campaignId], references: [tiktokCampaigns.id] }),
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
export type TiktokCampaign = typeof tiktokCampaigns.$inferSelect
export type TiktokScene = typeof tiktokScenes.$inferSelect
export type AiInfluencer = typeof aiInfluencers.$inferSelect
