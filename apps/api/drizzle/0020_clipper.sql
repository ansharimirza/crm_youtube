CREATE TABLE IF NOT EXISTS "clip_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "title" varchar(200) DEFAULT '' NOT NULL,
  "source_video_path" text,
  "requirements" text DEFAULT '' NOT NULL,
  "clip_count" integer DEFAULT 3 NOT NULL,
  "aspect_ratio" varchar(8) DEFAULT '9:16' NOT NULL,
  "status" varchar(16) DEFAULT 'queued' NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "clips" (
  "id" serial PRIMARY KEY NOT NULL,
  "job_id" integer NOT NULL REFERENCES "clip_jobs"("id") ON DELETE cascade,
  "title" varchar(200) DEFAULT '' NOT NULL,
  "start_sec" real NOT NULL,
  "end_sec" real NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "path" text,
  "status" varchar(16) DEFAULT 'rendering' NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
