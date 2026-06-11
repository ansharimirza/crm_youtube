CREATE TABLE IF NOT EXISTS "ai_influencers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"gender" varchar(16) NOT NULL,
	"age" integer NOT NULL,
	"niches" text DEFAULT '' NOT NULL,
	"face_ref_path" text,
	"style_ref_path" text,
	"backstory" text DEFAULT '' NOT NULL,
	"personality" integer DEFAULT 50 NOT NULL,
	"ethnicity" varchar(32) NOT NULL,
	"skin_tone" varchar(16) NOT NULL,
	"hair_color" varchar(16) NOT NULL,
	"hair_length" varchar(16) NOT NULL,
	"hair_texture" varchar(16) NOT NULL,
	"eye_color" varchar(16) NOT NULL,
	"build" varchar(16) NOT NULL,
	"custom_description" text DEFAULT '' NOT NULL,
	"aesthetic_vibe" varchar(24),
	"image_prompt" text DEFAULT '' NOT NULL,
	"image_url" text,
	"image_path" text,
	"image_geminigen_uuid" varchar(64),
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_msg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_influencers" ADD CONSTRAINT "ai_influencers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
