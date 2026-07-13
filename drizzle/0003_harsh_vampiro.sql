CREATE TABLE "global_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"store_name" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"payment_bucket" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"facturama_id" text,
	"uuid_cfdi" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "global_invoices_facturama_id_unique" UNIQUE("facturama_id"),
	CONSTRAINT "global_invoices_uuid_cfdi_unique" UNIQUE("uuid_cfdi"),
	CONSTRAINT "unique_global_period_bucket_chunk" UNIQUE("store_name","period_year","period_month","payment_bucket","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "global_invoice_id" text;--> statement-breakpoint
CREATE INDEX "idx_global_invoices_store_period" ON "global_invoices" USING btree ("store_name","period_year","period_month");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_global_invoice_id_global_invoices_id_fk" FOREIGN KEY ("global_invoice_id") REFERENCES "public"."global_invoices"("id") ON DELETE no action ON UPDATE no action;