-- Expand Minecraft game type capabilities for Mastermind Minecraft Server Manager.
INSERT INTO game_types (id, slug, name, capabilities, created_at)
VALUES (
  'gametypeminecraft0001',
  'minecraft',
  'Minecraft',
  '["start","stop","restart","status","send_command","kick_player","ban_player","get_log_path","install_mod"]'::jsonb,
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  capabilities = EXCLUDED.capabilities;
