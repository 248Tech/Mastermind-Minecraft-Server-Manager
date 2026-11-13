<div align="center">

<img src="site/assets/logo.png" alt="Mastermind logo" width="160">

# Mastermind — Minecraft Server Manager

**Control plane + Go host agent for Minecraft (Paper, NeoForge, Fabric) — safe restarts, RCON console, live map, plugin quarantine and world backups.**

[![Live Demo](https://img.shields.io/badge/▶_Live_Demo-sign_in_as_admin-16a34a?style=for-the-badge)](https://248tech.github.io/Mastermind-Minecraft-Server-Manager/demo/)

[![License: MIT](https://img.shields.io/github/license/248Tech/Mastermind-Minecraft-Server-Manager?style=flat-square&color=16a34a)](LICENSE)
[![Release](https://img.shields.io/badge/release-v0.16.2-16a34a?style=flat-square)](CHANGELOG.md)
[![Last commit](https://img.shields.io/github/last-commit/248Tech/Mastermind-Minecraft-Server-Manager?style=flat-square&color=22c55e)](https://github.com/248Tech/Mastermind-Minecraft-Server-Manager/commits/main)
[![Stars](https://img.shields.io/github/stars/248Tech/Mastermind-Minecraft-Server-Manager?style=flat-square&color=fb923c)](https://github.com/248Tech/Mastermind-Minecraft-Server-Manager/stargazers)
[![Issues](https://img.shields.io/github/issues/248Tech/Mastermind-Minecraft-Server-Manager?style=flat-square)](https://github.com/248Tech/Mastermind-Minecraft-Server-Manager/issues)
![Minecraft](https://img.shields.io/badge/Minecraft-Java-62B47A?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Go](https://img.shields.io/badge/Go_1.22-00ADD8?style=flat-square&logo=go&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000?style=flat-square&logo=nextdotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis_7-DC382D?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

[**Live demo**](https://248tech.github.io/Mastermind-Minecraft-Server-Manager/demo/) · [Project site](https://248tech.github.io/Mastermind-Minecraft-Server-Manager/) · [Quickstart](QUICKSTART.md) · [Production deploy](docs/production-deploy.md) · [Changelog](CHANGELOG.md)

</div>

> **Try it without installing anything:** open the [live demo](https://248tech.github.io/Mastermind-Minecraft-Server-Manager/demo/) and click **Enter as demo administrator** (or use `demo.admin@mastermind.demo` / `DemoAdmin!2026`). It is a static, in-browser simulation with mock data — no backend.

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
├── agent/            # Go host agent (Minecraft RCON + process control)
├── infra/            # Docker Compose for local/prod
├── docs/             # Architecture, adapter, production deploy
├── scripts/          # bring-up, restart-stack, prod-up, start-local-infra, …
├── Makefile
└── README.md
```

---

## Quickstart (Docker)

```bash
cp infra/.env.example infra/.env
# set JWT_SECRET, JWT_AGENT_SECRET, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD
make up
# or Windows: .\scripts\prod-up.ps1 -Build -Migrate
# or: docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
```

Web: http://localhost:3000 · API: http://localhost:3001  
Production notes: [docs/production-deploy.md](docs/production-deploy.md)

### Windows bring-up (no hardcoded Minecraft paths)

```powershell
# Optional when Docker Desktop is unavailable: portable Postgres+Redis under tools/
.\scripts\start-local-infra.ps1

# Control plane + web (uses Docker Compose for Postgres/Redis when available;
# falls back to local infra automatically if docker is missing)
.\scripts\bring-up.ps1
# or force local infra:
.\scripts\bring-up.ps1 -SkipDocker

# Later restarts (dev):
.\scripts\restart-stack.ps1 -WithAgent

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
