CREATE TABLE IF NOT EXISTS "veo_shorts" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "veo_projects"("id") ON DELETE cascade,
  "title" varchar(200) DEFAULT '' NOT NULL,
  "start_sec" real NOT NULL,
  "end_sec" real NOT NULL,
  "path" text,
  "status" varchar(16) DEFAULT 'rendering' NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
