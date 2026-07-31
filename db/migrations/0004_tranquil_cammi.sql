CREATE TABLE "attendance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"status" text,
	"logged_seconds" integer,
	"raw_time" text,
	"source" text,
	"run_id" text
);
