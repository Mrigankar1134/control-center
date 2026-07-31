CREATE TYPE "public"."audit_action" AS ENUM('SCHEDULE_UPDATED', 'AUTOMATION_RESUMED', 'AUTOMATION_PAUSED', 'MANUAL_DISPATCH');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor" text,
	"summary" text NOT NULL,
	"details" jsonb
);
