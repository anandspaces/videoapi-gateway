ALTER TABLE "consumers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "consumers" ADD COLUMN "password_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "consumers_email_unique" ON "consumers" USING btree ("email");