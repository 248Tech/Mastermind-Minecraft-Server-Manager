# Mastermind — Minecraft Server Manager Quickstart

A distributed game server manager with a NestJS control plane, Next.js web UI, and Go agent binary. **Minecraft-first** (Java / NeoForge / Fabric / Paper), with a legacy 7DTD adapter still present in the agent.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker Desktop | 24+ | Required for Postgres + Redis |
| Node.js | 20+ | For local dev |
| pnpm | 9+ | `npm install -g pnpm` |
| Go | 1.22+ | Only if building the agent locally |

---

## Option 0 — One command (recommended for v0.0.3)

```bash
git clone https://github.com/248Tech/Mastermind-Minecraft-Server-Manager && cd Mastermind-Minecraft-Server-Manager
make start
```

`make start` runs the full flow: checks tools, installs dependencies, builds agent binaries, starts Postgres/Redis, runs Prisma push + seed, and launches control-plane/web.

Use this unless you specifically need one of the manual paths below.

---

## Option A — Full Docker (fastest)

All services in containers, no local Node/Go required.

```bash
# 1. Clone & enter
git clone https://github.com/248Tech/Mastermind-Minecraft-Server-Manager && cd Mastermind-Minecraft-Server-Manager

# 2. Copy env and choose the first administrator
cp infra/.env.example infra/.env
# Edit infra/.env and set BOOTSTRAP_ADMIN_EMAIL and
# BOOTSTRAP_ADMIN_PASSWORD before the first start.

# 3. Start everything
cd infra && docker compose up -d

# 4. Open the UI
open http://localhost:3000
```

**Login:** use the bootstrap administrator credentials you placed in
`infra/.env`. There is no built-in default password.

> The control plane automatically runs migrations and seeds on startup.
> First boot takes ~30 s while images build.

---

## Option B — Local Dev (hot-reload)

Postgres + Redis in Docker; control plane and web run locally for fast iteration.

### Step 1 — Start the databases

```bash
make up
# Starts postgres:16 on :5432 and redis:7 on :6379
```

### Step 2 — Install dependencies

```bash
pnpm install                          # root workspace
cd control-plane && pnpm install && pnpm prisma:generate
cd ../web && pnpm install
```

Or use the helper script:

```bash
bash scripts/bootstrap.sh
```

### Step 3 — Copy env files

```bash
cp .env.example .env
cp control-plane/.env.example control-plane/.env
cp web/.env.example web/.env.local
```

Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` before seeding.
Replace every example secret before production use.

### Step 4 — Migrate + seed

```bash
make migrate
# Runs: prisma db push + ts-node prisma/seed.ts
```

### Step 5 — Start services

Open two terminals:

```bash
# Terminal 1 — Control plane (API on :3001)
cd control-plane && pnpm dev

# Terminal 2 — Web UI (on :3000)
cd web && pnpm dev
```

### Step 6 — Open the app

```
http://localhost:3000
# Sign in with the bootstrap administrator from your .env file.
```

---

## Option C — One command setup only (legacy)

```bash
make setup
```

This installs deps, starts Postgres/Redis, migrates, and seeds. It does not launch the web/control-plane dev servers.

For the new all-in-one command, use `make start`.

---

## Connecting a Host Agent

After logging in, go to **Hosts → Pair New Host**:

1. Click **Generate Install Token** — valid for 15 minutes.
2. Copy the install command for your target machine.
3. Choose an install method:

### Docker (recommended)

```bash
docker run -d \
  --name mastermind-agent \
  --restart unless-stopped \
  -e MASTERMIND_CP_URL="http://<your-cp-ip>:3001" \
  -e MASTERMIND_PAIRING_TOKEN="<token>" \
  -e MASTERMIND_HOST_NAME="my-server" \
  -v mastermind-agent-data:/var/lib/mastermind-agent \
  mastermind-agent
```

Build the image first:

```bash
cd agent && docker build -t mastermind-agent .
```

### Go binary (manual)

```bash
# Build
cd agent && go build -o mastermind-agent .

# Write config
sudo mkdir -p /etc/mastermind-agent
cat <<EOF | sudo tee /etc/mastermind-agent/config.yaml
control_plane_url: "http://<cp-ip>:3001"
pairing_token: "<token>"
agent_key_path: "/var/lib/mastermind-agent/agent.key"
heartbeat:
  interval_sec: 5
jobs:
  poll_interval_sec: 5
  long_poll_sec: 30
host:
  name: "my-server"
EOF

# Run
./mastermind-agent -config /etc/mastermind-agent/config.yaml
```

### Environment variables (no config file)

```bash
MASTERMIND_CP_URL=http://<cp-ip>:3001 \
MASTERMIND_PAIRING_TOKEN=<token> \
MASTERMIND_HOST_NAME=my-server \
./mastermind-agent
```

Once paired, the host appears in the **Hosts** table with status **Online**.

---

## Registering a Server Instance

After a host is online, go to **Hosts → Register Server**:

| Field | Example | Notes |
|-------|---------|-------|
| Name | `7dtd-alpha` | Display name |
| Game Type | `7dtd` | or `minecraft` |
| Host | *(select from list)* | The paired host |
| Install Path | `/opt/7dtd` | Root dir of the game server |
| Start Command | `./startserver.sh` | Relative to install path |
| Telnet Host | `127.0.0.1` | For 7DTD admin console |
| Telnet Port | `8081` | Default 7DTD telnet port |

---

## Creating Jobs

Go to **Jobs → + Create Job**. Select a server instance and job type:

| Type | Description |
|------|-------------|
| `start` | Start the server process |
| `stop` | Stop the server process |
| `restart` | Restart the server process |
| `rcon` | Run a console command (pass `command` in payload) |
| `custom` | Any allowlisted command |

Jobs are queued via BullMQ and claimed by the agent on next poll (every 5 s).

---

## Schedules

Go to **Schedules → + Add Schedule** to run jobs automatically on a cron schedule.

| Field | Example |
|-------|---------|
| Cron Expression | `0 4 * * *` = daily at 4 AM |
| Job Type | `restart` |
| Server Instance | *(select)* |

The control plane enqueues delayed BullMQ jobs for each fire time and reschedules after completion.

---

## Alert Rules

Go to **Alerts → + Add Alert Rule** to receive Discord notifications.

Configure:
- **Alert Type**: `heartbeat_missed` — fires when a host stops sending heartbeats
- **Discord Webhook URL**: the channel that receives the message

Set the org-level webhook under **Settings → Discord Webhook**.

---

## API Reference (control plane — port 3001)

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register new user |
| `POST` | `/api/auth/login` | Login → `{ access_token, userId, orgId }` |
| `GET` | `/api/auth/me` | Current user profile |

### Orgs
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orgs` | List user's orgs |
| `POST` | `/api/orgs` | Create org |
| `GET` | `/api/orgs/:orgId` | Get org detail |
| `PATCH` | `/api/orgs/:orgId` | Update org (e.g. `discordWebhookUrl`) |

### Hosts
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orgs/:orgId/hosts` | List hosts |
| `GET` | `/api/orgs/:orgId/hosts/:hostId` | Host detail |

### Pairing
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/orgs/:orgId/pairing-tokens` | Generate pairing token |
| `POST` | `/api/agent/pair` | Agent: complete pairing |

### Server Instances
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orgs/:orgId/server-instances` | List |
| `POST` | `/api/orgs/:orgId/server-instances` | Create |
| `PATCH` | `/api/orgs/:orgId/server-instances/:id` | Update |
| `DELETE` | `/api/orgs/:orgId/server-instances/:id` | Delete |

### Jobs
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orgs/:orgId/jobs` | List jobs |
| `POST` | `/api/orgs/:orgId/jobs` | Create job |

### Schedules
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orgs/:orgId/schedules` | List schedules |
| `POST` | `/api/orgs/:orgId/schedules` | Create schedule |
| `PATCH` | `/api/orgs/:orgId/schedules/:id` | Update (enable/disable) |
| `DELETE` | `/api/orgs/:orgId/schedules/:id` | Delete |

### Alerts
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orgs/:orgId/alerts` | List alert rules |
| `POST` | `/api/orgs/:orgId/alerts` | Create alert rule |
| `PATCH` | `/api/orgs/:orgId/alerts/:id` | Update (enable/disable) |
| `DELETE` | `/api/orgs/:orgId/alerts/:id` | Delete |

### Agent endpoints (JWT_AGENT_SECRET)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agent/hosts/:hostId/heartbeat` | Send heartbeat + metrics |
| `GET` | `/api/agent/hosts/:hostId/jobs/poll` | Poll for next job |
| `POST` | `/api/agent/hosts/:hostId/jobs/:runId/result` | Report job result |

---

## Environment Variables

### control-plane/.env

```env
PORT=3001
DATABASE_URL=postgresql://mastermind:changeme@localhost:5432/mastermind
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=change-me-user-secret
JWT_AGENT_SECRET=change-me-agent-secret
```

### web/.env.local

```env
NEXT_PUBLIC_CONTROL_PLANE_URL=http://localhost:3001
```

> `NEXT_PUBLIC_CONTROL_PLANE_URL` is baked into the browser bundle at build time — use the URL that **browsers** can reach, not Docker internal hostnames.

---

## Make targets

```bash
make start      # New all-in-one start (install + build agent + infra + migrate + run web/api)
make setup      # Full first-time setup (install + start infra + migrate + seed)
make up         # Start Postgres + Redis only
make up-dev     # Start all services with hot-reload (Docker)
make up-prod    # Start all services with production builds (Docker)
make down       # Stop all Docker services
make migrate    # Run DB push + seed (requires Postgres running)
make logs       # Tail Docker logs
make doctor     # Check required tools are installed
```

---

## First administrator

Set these in `infra/.env` before the first start:

```env
BOOTSTRAP_ADMIN_EMAIL=you@example.com
BOOTSTRAP_ADMIN_PASSWORD=use-a-unique-password-of-at-least-12-characters
BOOTSTRAP_ADMIN_NAME=Administrator
```

The seed promotes that account to administrator in the `default`
organization. Public sign-ups are created as pending viewers and cannot open
the dashboard until an administrator approves them from **Accounts**.

---

## Architecture Overview

```
Browser → Web (Next.js :3000)
            ↓ fetch (JWT)
        Control Plane (NestJS :3001)
            ↓ Prisma          ↓ BullMQ
          Postgres          Redis
            ↑ poll (JWT_AGENT_SECRET)
        Agent (Go binary on game server host)
            ↓ exec
        Game Server (7DTD / Minecraft)
```

- **Two JWT secrets** — user tokens use `JWT_SECRET`; agent tokens use `JWT_AGENT_SECRET`
- **One BullMQ queue per org** — named `jobs:{orgId}`; agent polls and claims jobs
- **Heartbeat** — agent sends CPU/RAM/disk metrics every 5 s; host `status` updates to `online`/`offline`
- **Pairing** — single-use token (15-min TTL) generates an agent JWT on first connection
