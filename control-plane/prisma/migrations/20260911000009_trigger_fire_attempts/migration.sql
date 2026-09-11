-- Track delivery attempts / last error for trigger item grants (parity with shop grants).
ALTER TABLE "trigger_fires" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "trigger_fires" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
