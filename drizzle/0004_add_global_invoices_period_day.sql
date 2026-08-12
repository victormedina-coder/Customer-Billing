ALTER TABLE "global_invoices" DROP CONSTRAINT "unique_global_period_bucket_chunk";--> statement-breakpoint
ALTER TABLE "global_invoices" ADD COLUMN "period_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_invoices" ADD CONSTRAINT "unique_global_period_bucket_chunk" UNIQUE("store_name","period_year","period_month","period_day","payment_bucket","chunk_index");