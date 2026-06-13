-- Drop old TikTok test data (user confirmed it was testing)
DELETE FROM "tiktok_scenes";--> statement-breakpoint
DELETE FROM "tiktok_campaigns";--> statement-breakpoint

-- Create shared frames table
CREATE TABLE IF NOT EXISTS "tiktok_frames" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign_id" integer NOT NULL,
  "frame_number" integer NOT NULL,
  "image_prompt" text DEFAULT '' NOT NULL,
  "status" varchar(16) DEFAULT 'draft' NOT NULL,
  "image_url" text,
  "image_path" text,
  "geminigen_uuid" varchar(64),
  "attempts" integer DEFAULT 0 NOT NULL,
  "error_msg" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tiktok_frames" ADD CONSTRAINT "tiktok_frames_campaign_id_tiktok_campaigns_id_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "public"."tiktok_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Drop legacy scene image columns
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "image_prompt";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "end_image_prompt";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "image_status";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "image_url";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "image_path";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "image_geminigen_uuid";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "image_attempts";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "image_error_msg";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "end_image_status";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "end_image_url";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "end_image_path";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "end_image_geminigen_uuid";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "end_image_attempts";--> statement-breakpoint
ALTER TABLE "tiktok_scenes" DROP COLUMN IF EXISTS "end_image_error_msg";--> statement-breakpoint

-- Add frame FKs to scenes
ALTER TABLE "tiktok_scenes" ADD COLUMN "start_frame_id" integer;--> statement-breakpoint
ALTER TABLE "tiktok_scenes" ADD COLUMN "end_frame_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tiktok_scenes" ADD CONSTRAINT "tiktok_scenes_start_frame_id_tiktok_frames_id_fk"
    FOREIGN KEY ("start_frame_id") REFERENCES "public"."tiktok_frames"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tiktok_scenes" ADD CONSTRAINT "tiktok_scenes_end_frame_id_tiktok_frames_id_fk"
    FOREIGN KEY ("end_frame_id") REFERENCES "public"."tiktok_frames"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Widen campaign.status varchar (new enum values)
ALTER TABLE "tiktok_campaigns" ALTER COLUMN "status" TYPE varchar(24);
