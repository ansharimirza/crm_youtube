ALTER TABLE "veo_projects" ADD COLUMN IF NOT EXISTS "narration_full_path" text;
ALTER TABLE "veo_projects" ADD COLUMN IF NOT EXISTS "narration_full_duration" real;
