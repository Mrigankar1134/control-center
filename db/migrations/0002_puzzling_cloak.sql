CREATE TABLE "holiday_exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"exception_date" date NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_exceptions_exception_date_unique" UNIQUE("exception_date")
);
