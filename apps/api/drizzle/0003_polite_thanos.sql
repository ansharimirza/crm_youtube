CREATE TABLE IF NOT EXISTS "tiktok_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"mode" varchar(32) NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"language" varchar(8) DEFAULT 'id' NOT NULL,
	"base_model_path" text,
	"product_image_path" text,
	"product_url" text,
	"product_name" varchar(255) NOT NULL,
	"product_description" text DEFAULT '' NOT NULL,
	"environment" text NOT NULL,
	"aspect_ratio" varchar(8) DEFAULT '9:16' NOT NULL,
	"resolution" varchar(8) DEFAULT '1080p' NOT NULL,
	"veo_model" varchar(32) DEFAULT 'veo-2' NOT NULL,
	"scene_count" integer DEFAULT 4 NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tiktok_scenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"scene_number" integer NOT NULL,
	"script" text NOT NULL,
	"veo_prompt" text NOT NULL,
	"duration" integer DEFAULT 4 NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"geminigen_uuid" varchar(64),
	"geminigen_id" integer,
	"video_url" text,
	"thumbnail_url" text,
	"error_msg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anthropic_api_key" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tiktok_campaigns" ADD CONSTRAINT "tiktok_campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tiktok_scenes" ADD CONSTRAINT "tiktok_scenes_campaign_id_tiktok_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."tiktok_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
