ALTER TABLE "invoices" ADD COLUMN "privacy_version" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "consent_at" timestamp;