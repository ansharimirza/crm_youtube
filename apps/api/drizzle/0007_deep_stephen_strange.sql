CREATE TABLE IF NOT EXISTS "motion_videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(200) DEFAULT '' NOT NULL,
	"character_image_path" text NOT NULL,
	"reference_video_path" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"aspect_ratio" varchar(8) DEFAULT '9:16' NOT NULL,
	"duration" integer DEFAULT 5 NOT NULL,
	"model" varchar(32) DEFAULT 'kling-video-motion-3' NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"geminigen_uuid" varchar(64),
	"video_url" text,
	"thumbnail_url" text,
	"error_msg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "motion_videos" ADD CONSTRAINT "motion_videos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
