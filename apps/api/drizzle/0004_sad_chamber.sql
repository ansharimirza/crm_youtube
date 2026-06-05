ALTER TABLE "tiktok_scenes" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "tiktok_scenes" ADD COLUMN "image_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_scenes" ADD COLUMN "image_status" varchar(16) DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_scenes" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "tiktok_scenes" ADD COLUMN "image_path" text;--> statement-breakpoint
ALTER TABLE "tiktok_scenes" ADD COLUMN "image_geminigen_uuid" varchar(64);--> statement-breakpoint
ALTER TABLE "tiktok_scenes" ADD COLUMN "image_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_scenes" ADD COLUMN "image_error_msg" text;