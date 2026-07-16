ALTER TABLE "clip_jobs" ADD COLUMN IF NOT EXISTS "captions" boolean DEFAULT true NOT NULL;
