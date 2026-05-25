CREATE TYPE "public"."request_outcome" AS ENUM('success', 'upstream_error', 'timeout', 'gateway_error', 'blocked');--> statement-breakpoint
CREATE TABLE "api_request_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"consumer_id" text,
	"api_key_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"upstream_url" text,
	"outcome" "request_outcome" NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"status_code" integer NOT NULL,
	"upstream_status_code" integer,
	"duration_ms" integer NOT NULL,
	"upstream_duration_ms" integer,
	"request_bytes" integer,
	"response_bytes" integer,
	"content_type" text,
	"error_code" text,
	"error_message" text,
	"credits_charged" real,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_request_logs_consumer_idx" ON "api_request_logs" USING btree ("consumer_id");--> statement-breakpoint
CREATE INDEX "api_request_logs_request_id_idx" ON "api_request_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "api_request_logs_created_at_idx" ON "api_request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_request_logs_outcome_idx" ON "api_request_logs" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "api_request_logs_status_idx" ON "api_request_logs" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "api_request_logs_path_idx" ON "api_request_logs" USING btree ("path");