-- Faceless-video pipeline: narration per scene + auto-edit assembly on project

ALTER TABLE "veo_scenes" ADD COLUMN IF NOT EXISTS "narration_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "veo_scenes" ADD COLUMN IF NOT EXISTS "narration_audio_path" text;--> statement-breakpoint
ALTER TABLE "veo_scenes" ADD COLUMN IF NOT EXISTS "narration_duration" real;--> statement-breakpoint

ALTER TABLE "veo_projects" ADD COLUMN IF NOT EXISTS "music_path" text;--> statement-breakpoint
ALTER TABLE "veo_projects" ADD COLUMN IF NOT EXISTS "final_video_path" text;--> statement-breakpoint
ALTER TABLE "veo_projects" ADD COLUMN IF NOT EXISTS "final_video_url" text;--> statement-breakpoint
ALTER TABLE "veo_projects" ADD COLUMN IF NOT EXISTS "assemble_status" varchar(16) DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "veo_projects" ADD COLUMN IF NOT EXISTS "assemble_error" text;
