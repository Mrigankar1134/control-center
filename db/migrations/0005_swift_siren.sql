CREATE TYPE "public"."run_action" AS ENUM('Check-in', 'Check-out');--> statement-breakpoint
CREATE TYPE "public"."run_source" AS ENUM('CRON', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCESS', 'SKIPPED', 'FAILED');--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"exception_date" date NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exceptions_exception_date_unique" UNIQUE("exception_date")
);
--> statement-breakpoint
CREATE TABLE "run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"source" "run_source" NOT NULL,
	"action" "run_action",
	"status" "run_status" NOT NULL,
	"logged_seconds" integer,
	"raw_time" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"random_offset_minutes" integer DEFAULT 25 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_day_of_week_unique" UNIQUE("day_of_week")
);
