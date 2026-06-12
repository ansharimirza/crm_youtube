ALTER TABLE "motion_videos" DROP COLUMN IF EXISTS "duration";--> statement-breakpoint
ALTER TABLE "motion_videos" ADD COLUMN "resolution" varchar(8) DEFAULT '720p' NOT NULL;
