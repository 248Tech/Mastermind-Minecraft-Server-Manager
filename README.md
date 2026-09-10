# Mastermind — Minecraft Server Manager

**Control Plane + Host Agent** for managing Minecraft (Java / NeoForge / Fabric / Paper) servers. Instead of SSH’ing into each box, you run a small agent on every host; the control plane sends jobs (start, stop, safe restart, RCON, backups, etc.) and the agent runs them locally.

This product is **Minecraft-only**. It was branched from [Mastermind-7DTD-AI-Server-Manager](https://github.com/248Tech/Mastermind-7DTD-AI-Server-Manager); the 7DTD agent, Allocs/PrismaCore integrations, and related UI were removed in 0.2.0.

---

## In plain English

Mastermind is a control panel for Minecraft servers. It lets an owner see what is happening, make common changes safely, and give trusted staff the right amount of access—without handing everyone SSH or asking them to edit `server.properties` by hand.

### What you can do

| If you want to… | Start here |
|---|---|
| See whether the server is healthy | **Dashboard → Health** |
| Read logs or talk to the server via RCON | **Logs / Jobs → Console** |
| Manage players (kick, ban, op/deop) | **Players** |
| List mods / plugins on disk | **Mods** |
| Back up or wipe the world | **Worlds** |
| Schedule restarts and backups | **Schedules** |
| Configure Discord, email, AI, or security | **Settings** |
| Let players see their portal | **Player Portal** at `/player` |

### Choose the setup that fits

- **Just trying it locally?** Use the Docker Compose quickstart below.
- **Running a real game host?** Install the Go agent on the host and pair it from the dashboard. Point discovery at your install via `MASTERMIND_MC_INSTALL_PATH` (or `agent/config.local.yaml`).
- **Hosting Mastermind on a VPS?** Follow [`docs/DIGITALOCEAN_DEPLOYMENT.md`](docs/DIGITALOCEAN_DEPLOYMENT.md), then keep RCON private on loopback.

---

## Architecture overview

```
    ┌─────────────────────────────────────────────────────────────────┐
    │                     CONTROL PLANE (NestJS)                       │
    │  Web (Next.js) ◄── API + WebSocket ◄── Postgres + Redis/BullMQ   │
    └─────────────────────────────────────────────────────────────────┘
        │                    │
        │ HTTPS/WS           │ Job queue / heartbeat
        ▼                    ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │  HOST: Agent (Go) — pairing, heartbeat, job runner, MC adapter   │
    │         ◄──────────────────────────────────────────────────────►  │
    │              Minecraft server (RCON + process + filesystem)       │
    └─────────────────────────────────────────────────────────────────┘
```

### How an action travels

1. A staff member clicks an action in the web dashboard.
2. The control plane checks the account role and puts the action in the correct server’s job queue.
3. The paired host agent receives the job and runs it locally through the Minecraft adapter.
4. The result, logs, and account attribution return to the dashboard.

---

## Minecraft requirements

Enable RCON in `server.properties`:

```properties
enable-rcon=true
rcon.port=25575
rcon.password=your-secure-password
```

On the agent, `telnet_*` server-instance fields store **RCON** host/port/password (same schema as the 7DTD fork).

Agent discovery (optional) reads `server.properties` and can sync install path, MOTD name, world folder, and mod counts. Configure via env (no hardcoded paths):

```bash
MASTERMIND_MC_DISCOVERY_ENABLED=true
MASTERMIND_MC_INSTALL_PATH=/path/to/your/minecraft-server
MASTERMIND_MC_START_COMMAND=/path/to/your/minecraft-server/run.bat   # optional
MASTERMIND_MC_NAME="My Pack Server"                                   # optional
```

See [`docs/minecraft-adapter-config.md`](docs/minecraft-adapter-config.md) and [`agent/config.minecraft.example.yaml`](agent/config.minecraft.example.yaml).

### Adapter job coverage (v0.1.0)

- Lifecycle: `SERVER_START` / `STOP` / `RESTART` / `SAFE_RESTART` / `KILL`
- Console: `RCON` / `SEND_COMMAND`, `STATUS`, `LIST_PLAYERS`
- Players: kick / kick-all / ban / op / deop
- World: `SERVER_SAVEWORLD`, `SAVE_BACKUP`, `SERVER_WIPE_SAVE` (confirmed)
- Config: `SERVER_CONFIG_READ` / `WRITE` for `server.properties`
- Mods: `MOD_LIST` for `mods/` and `plugins/`

---

## Tech stack

| Layer          | Tech                               |
|----------------|------------------------------------|
| Control plane  | NestJS, TypeScript, Prisma, BullMQ |
| Web            | Next.js, React, TypeScript         |
| Agent          | Go 1.22+                           |
| Data           | PostgreSQL 16, Redis 7             |
| Local dev      | Docker Compose                     |

---

## Repo layout

```
├── control-plane/    # NestJS API (REST + WS), Prisma, jobs, pairing, alerts
├── web/              # Next.js frontend
├── discord-bot/      # Optional Discord slash-command bridge
├── agent/            # Go host agent (Minecraft + legacy 7DTD adapters)
├── infra/            # Docker Compose for local/prod
├── docs/             # Architecture and adapter docs
├── scripts/          # bootstrap.sh, start.sh, doctor.sh, …
├── Makefile
└── README.md
```

---

## Quickstart (Docker)

```bash
cp .env.example .env
# set JWT_SECRET, JWT_AGENT_SECRET, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD
make up
# or: docker compose -f infra/docker-compose.yml up -d
```

Web: http://localhost:3000 · API: http://localhost:3001

### Windows bring-up (no hardcoded Minecraft paths)

```powershell
# Optional when Docker Desktop is unavailable: portable Postgres+Redis under tools/
.\scripts\start-local-infra.ps1

# Control plane + web (uses Docker Compose for Postgres/Redis when available;
# falls back to local infra automatically if docker is missing)
.\scripts\bring-up.ps1
# or force local infra:
.\scripts\bring-up.ps1 -SkipDocker

# Agent — copy example env and set YOUR install path (never commit this file)
Copy-Item agent\.env.agent.example agent\.env.agent
# edit MASTERMIND_MC_INSTALL_PATH=C:/path/to/your/minecraft-server
# after pairing token from Hosts → Pair:
.\scripts\run-agent.ps1
```

`MASTERMIND_MC_INSTALL_PATH` (and optional `MASTERMIND_MC_*` overrides) must be set per host. Committed examples use placeholders only.
## Security notes

- Keep RCON bound to localhost (or a private network). Never expose RCON publicly.
- Treat agent keys and JWT secrets like production credentials.
- World wipe and restore jobs require explicit confirmation payloads.

---

## Lineage

This repository is a Minecraft-first fork of Mastermind for 7 Days to Die. Legacy 7DTD adapter code remains for multi-game agents, but the product UI and defaults target Minecraft.
