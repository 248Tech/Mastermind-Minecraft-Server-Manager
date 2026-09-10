-- Drop 7DTD player/shop residue (vehicles, EOS, zombie kills, chat color, land claims, grant quality columns).
DROP TABLE IF EXISTS "player_vehicle_history";

ALTER TABLE "Player" DROP COLUMN IF EXISTS "eos_id";
ALTER TABLE "Player" DROP COLUMN IF EXISTS "zombie_kills";

ALTER TABLE "ShopItem" DROP COLUMN IF EXISTS "grant_quality";
ALTER TABLE "ShopItem" DROP COLUMN IF EXISTS "chat_color";
ALTER TABLE "ShopItem" DROP COLUMN IF EXISTS "bonus_land_claims";

DROP INDEX IF EXISTS "DonationLine_chat_color_status_idx";
ALTER TABLE "DonationLine" DROP COLUMN IF EXISTS "grant_quality";
ALTER TABLE "DonationLine" DROP COLUMN IF EXISTS "chat_color";
ALTER TABLE "DonationLine" DROP COLUMN IF EXISTS "bonus_land_claims";
ALTER TABLE "DonationLine" DROP COLUMN IF EXISTS "chat_color_status";
