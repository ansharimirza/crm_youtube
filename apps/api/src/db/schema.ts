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
  model: varchar('model', { length: 32, enum: ['veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite', 'veo-2'] }).default('veo-2').notNull(),
  aspectRatio: varchar('aspect_ratio', { length: 8, enum: ['16:9', '9:16'] }).default('16:9').notNull(),
  resolution: varchar('resolution', { length: 8, enum: ['720p', '1080p'] }).default('720p').notNull(),
  duration: integer('duration').default(4).notNull(),
  modeImage: varchar('mode_image', { length: 16, enum: ['frame', 'ingredient'] }).default('frame').notNull(),
  firstImagePath: text('first_image_path'),
  lastImagePath: text('last_image_path'),
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
