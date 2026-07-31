CREATE TYPE "public"."action_type" AS ENUM('ACTION_ALPHA', 'ACTION_BETA');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('QUEUED', 'EXECUTING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TABLE "dispatch_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"action_type" "action_type" NOT NULL,
	"status" "status" NOT NULL,
	"execution_duration_ms" integer,
	"payload" jsonb,
	"artifact_url" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "schedule_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"window_a_time" text DEFAULT '09:19' NOT NULL,
	"window_b_time" text DEFAULT '19:17' NOT NULL,
	"random_offset_minutes" integer DEFAULT 25 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_config_day_of_week_unique" UNIQUE("day_of_week")
);
