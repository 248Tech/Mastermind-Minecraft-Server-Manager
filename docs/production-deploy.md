# Production deploy — Mastermind Minecraft Server Manager

Two supported layouts:

| Layout | When to use |
|--------|-------------|
| **Docker Compose** (`infra/`) | Linux VPS / Docker Desktop with Compose. Runs Postgres, Redis, control-plane, web. |
| **Portable Windows** (`scripts/start-local-infra.ps1` + `bring-up.ps1 -SkipDocker`) | Windows hosts where Docker Desktop is unavailable; uses `tools/pgsql` + `tools/redis`. |

The **Go agent always runs on the Minecraft host** (outside Compose). It needs filesystem access to the pack install (`MASTERMIND_MC_INSTALL_PATH`) and local RCON.

Do **not** hardcode Minecraft install paths in committed files.

## Docker production (recommended)

1. Copy env and set strong secrets:

```bash
cp infra/.env.example infra/.env
# JWT_SECRET, JWT_AGENT_SECRET, PLAYER_JWT_SECRET, POSTGRES_PASSWORD, BOOTSTRAP_ADMIN_*
```

2. Start stack (from repo root on Windows):

```powershell
.\scripts\prod-up.ps1 -Build -Migrate
```

Or Linux:

```bash
cd infra
docker compose --env-file .env up -d --build
docker compose exec -T control-plane sh -c "npx prisma migrate deploy"
```

3. Optional profiles:

- Cloudflare tunnel: put token in `infra/secrets/cloudflare_tunnel_token`, then  
  `.\scripts\prod-up.ps1 -WithCloudflared`
- Discord bot: set `DISCORD_*` / `MASTERMIND_*` in `infra/.env`, then  
  `.\scripts\prod-up.ps1 -WithDiscordBot`

4. Pair the game host agent:

```powershell
Copy-Item agent\.env.agent.example agent\.env.agent
# MASTERMIND_CONTROL_PLANE_URL=https://your-cp-host
# MASTERMIND_MC_INSTALL_PATH=C:/path/to/minecraft-server
# MASTERMIND_PAIRING_TOKEN=...
.\scripts\run-agent.ps1

# Optional: start at Windows boot via Scheduled Task
.\scripts\install-agent-service.ps1
```

Defaults bind to `127.0.0.1` — put a reverse proxy (Caddy/nginx/Traefik) or Cloudflare tunnel in front for public HTTPS.

## Windows portable (no Docker)

```powershell
.\scripts\start-local-infra.ps1
.\scripts\bring-up.ps1 -SkipDocker
# later restarts:
.\scripts\restart-stack.ps1 -WithAgent
```

Point `control-plane/.env` at:

```
DATABASE_URL=postgresql://mastermind:changeme@localhost:5432/mastermind
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Checklist

- [ ] All `JWT_*` / encryption secrets changed from defaults
- [ ] `BOOTSTRAP_ADMIN_PASSWORD` set once, then cleared from env after first login
- [ ] RCON enabled in `server.properties`, password matches instance `telnet_*` fields
- [ ] Agent `MASTERMIND_MC_INSTALL_PATH` set; start command uses OS-native launcher (`.bat` on Windows)
- [ ] Compose ports stay on loopback unless intentionally LAN-exposed
- [ ] Mod upload volume (`mod_uploads`) has enough disk for ZIP staging
- [ ] Backups: schedule `SAVE_BACKUP` / host-level volume snapshots for Postgres

## Health

- Control plane: `GET /health`
- Web: `GET /` on `WEB_PORT`
- Agent: Hosts page shows online after pairing
