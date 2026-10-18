ALTER TABLE "usage_quota" ADD COLUMN "uploads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "analyses_user_created_idx" ON "analyses" USING btree ("user_id","created_at");