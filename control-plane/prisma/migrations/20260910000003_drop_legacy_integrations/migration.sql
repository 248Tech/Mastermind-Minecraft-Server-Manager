-- Drop unused Frigate NVR + 7DTD blood-moon org columns.
ALTER TABLE "Org" DROP COLUMN IF EXISTS "frigate_url";
ALTER TABLE "Org" DROP COLUMN IF EXISTS "frigate_api_key";
ALTER TABLE "Org" DROP COLUMN IF EXISTS "frigate_webhook_secret";
ALTER TABLE "Org" DROP COLUMN IF EXISTS "avoid_blood_moon_restart";
