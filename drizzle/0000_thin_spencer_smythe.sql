CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_number" text NOT NULL,
	"store_name" text NOT NULL,
	"facturama_id" text,
	"uuid_cfdi" text,
	"rfc_receptor" text,
	"razon_social" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"invoice_type" text DEFAULT 'individual' NOT NULL,
	"payment_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"cancelled_at" timestamp,
	CONSTRAINT "invoices_facturama_id_unique" UNIQUE("facturama_id"),
	CONSTRAINT "invoices_uuid_cfdi_unique" UNIQUE("uuid_cfdi"),
	CONSTRAINT "unique_order_store" UNIQUE("order_id","store_name")
);
--> statement-breakpoint
CREATE INDEX "idx_invoices_store_name_created_at" ON "invoices" USING btree ("store_name","created_at");--> statement-breakpoint
CREATE INDEX "idx_invoices_invoice_type_status" ON "invoices" USING btree ("invoice_type","status");