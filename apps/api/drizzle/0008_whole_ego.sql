CREATE TABLE IF NOT EXISTS "ai_influencer_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"influencer_id" integer NOT NULL,
	"change_description" text DEFAULT '' NOT NULL,
	"reference_image_path" text,
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
 ALTER TABLE "ai_influencer_variants" ADD CONSTRAINT "ai_influencer_variants_influencer_id_ai_influencers_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."ai_influencers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
