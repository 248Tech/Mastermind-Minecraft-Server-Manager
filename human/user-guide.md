# Mastermind — User Guide

> A complete walkthrough from installation to daily use.
> Covers: setup, agent pairing, server registration, jobs, schedules, bulk operations, Discord alerts, and roles.

---

## Table of Contents

1. [What Is Mastermind?](#1-what-is-mastermind)
2. [Prerequisites](#2-prerequisites)
3. [Installation & First Boot](#3-installation--first-boot)
4. [Logging In](#4-logging-in)
5. [Connecting a Host (Agent Pairing)](#5-connecting-a-host-agent-pairing)
6. [Registering a Game Server](#6-registering-a-game-server)
7. [Running Jobs (Start / Stop / Restart / RCON)](#7-running-jobs-start--stop--restart--rcon)
8. [Scheduled Jobs](#8-scheduled-jobs)
9. [Bulk Operations (Batches)](#9-bulk-operations-batches)
10. [Discord Alerts](#10-discord-alerts)
11. [Roles & Permissions (RBAC)](#11-roles--permissions-rbac)
12. [Supported Games](#12-supported-games)
13. [Troubleshooting](#13-troubleshooting)
14. [Security Notes](#14-security-notes)
15. [API Quick Reference](#15-api-quick-reference)
16. [Player portal, shop, and live map](#16-player-portal-shop-and-live-map)

---

## 1. What Is Mastermind?

Mastermind is a self-hosted dashboard for managing game servers — primarily **7 Days to Die** — across one or more machines, without SSH-ing into each box individually.

```
Your Browser  ──►  Web UI (Next.js, port 3000)
                        │
                        ▼
               Control Plane (NestJS, port 3001)
               Postgres (state) + Redis (job queue)
                        │
                        ▼  job dispatch over HTTPS
               Agent (Go binary, runs on each game host)
                        │
                        ▼  RCON / Telnet / process control
               Game Server (7DTD, Minecraft, …)
```

**What you can do from the dashboard:**

- See all your hosts (machines) and their online/offline status
- Register game server instances (each host can run multiple servers)
- Start, stop, or restart servers with one click
- Send raw RCON/Telnet commands
- Set up cron schedules (e.g. daily restart at 03:00)
- Run bulk operations across many servers at once (restart wave)
- Receive Discord alerts when a host goes offline or a server restarts
- Full audit log of every action
- Live server map (players from PrismaCore, zombies/animals from Allocs)
- Player portal shop and Steam profile (separate from staff tools)

---

## 2. Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20 LTS | Control plane + web |
| pnpm | 9.x | Package manager |
| Go | 1.22+ | Building the agent |
| Docker + Compose v2 | Latest | Postgres + Redis |

**Install pnpm** (if not already installed):
```bash
corepack enable && corepack prepare pnpm@latest --activate
```

**Ports used:**

| Port | Service |
|------|---------|
| 3000 | Web UI |
| 3001 | Control Plane API |
| 5432 | PostgreSQL |
| 6379 | Redis |

Make sure nothing else is using these before you start.

---

## 3. Installation & First Boot

### Step 1 — Clone and bootstrap

```bash
git clone <your-repo-url>
cd Mastermind-Minecraft-Server-Manager

# Install all dependencies (runs in all packages)
make bootstrap
# or manually: cd control-plane && pnpm install && cd ../web && pnpm install
```

### Step 2 — Start Postgres and Redis

```bash
make up
# or:
cd infra && docker compose up -d
```

Verify they are healthy:
```bash
docker compose -f infra/docker-compose.yml ps
```
Both `postgres` and `redis` should show `healthy`.

### Step 3 — Configure the control plane

Copy and edit the environment file:
```bash
cp control-plane/.env.example control-plane/.env
```

Minimum required values in `control-plane/.env`:
```env
DATABASE_URL=postgresql://mastermind:changeme@localhost:5432/mastermind
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=replace-with-a-random-secret-at-least-32-chars
JWT_AGENT_SECRET=replace-with-a-different-random-secret
PORT=3001
```

> **Security:** Change `JWT_SECRET` and `JWT_AGENT_SECRET` to random strings before any real use. Never leave them as defaults.

### Step 4 — Initialize database schema

```bash
cd control-plane
pnpm prisma db push
```

This creates all tables. Run once on first setup and again after schema changes.

### Step 5 — Seed the database

The seed script creates the default org, game type definitions (7DTD, Minecraft), roles, and an admin account:

```bash
cd control-plane
npx ts-node prisma/seed.ts
```

This is **idempotent** — safe to run multiple times.

Default admin account created by the seed:
- **Email:** `admin@mastermind.local`
- **Password:** `changeme`

> Change the password after first login via the Settings page.

### Step 6 — Start the control plane

```bash
cd control-plane
pnpm dev
# Listening on http://localhost:3001
```

Verify it is running:
```bash
curl http://localhost:3001/health
# → {"status":"ok"}
```

### Step 7 — Start the web UI

In a separate terminal:
```bash
cd web
pnpm dev
# → http://localhost:3000
```

Open **http://localhost:3000** in your browser. You should see:
- "Mastermind — 7DTD Server Manager"
- "Backend status: Connected — control plane is healthy."

If the backend status shows "Not connected," make sure the control plane is running and the web can reach it (check `NEXT_PUBLIC_CONTROL_PLANE_URL` in `web/.env.local` if needed).

### Alternative: Full Docker stack

To run everything in Docker (control plane + web + dependencies):
```bash
cd infra && docker compose --profile full up -d
```
This uses the Dockerfiles in `control-plane/` and `web/`. The control-plane container runs `prisma db push` and seed on startup to initialize schema and default data automatically.

---

## 4. Logging In

Navigate to **http://localhost:3000/login**.

### Login

Use the default credentials seeded above:
- Email: `admin@mastermind.local`
- Password: `changeme`

Click **Login**. You will be redirected to the dashboard.

### Register a new account

Click the **Register** tab on the login page. Enter your email, password, and an optional display name. The first registered user in an org is granted **admin** role; subsequent users get **operator** by default.

### What happens after login

Your JWT token is stored in the browser's localStorage (`mm_token`). The sidebar shows the navigation for all dashboard sections. The token lasts 7 days; after expiry you will be redirected back to login.

---

## 5. Connecting a Host (Agent Pairing)

Before you can manage a game server, you need to connect the machine it runs on. This is called **pairing** — the agent on the host exchanges a one-time token for a signed key.

### Part A: Generate a pairing token (in the UI)

1. Go to **Hosts** in the sidebar.
2. Click **Pair New Host**.
3. The UI calls `POST /api/orgs/:orgId/pairing-tokens` and returns a token.
4. **Copy the token immediately** — it is shown only once and expires in 15 minutes.

The token is stored as a SHA-256 hash; the plaintext is never saved on the server.

### Part B: Install and configure the agent (on the game host machine)

**Build the agent** (from the repo root, or cross-compile for the target OS):
```bash
cd agent
go build -o mastermind-agent ./...
```

Copy the binary to the game host machine.

**Create the config file** on the game host:
```bash
cp config.yaml.example /etc/mastermind-agent/config.yaml
# or any path you prefer; pass with --config flag
```

Edit `/etc/mastermind-agent/config.yaml`:
```yaml
control_plane_url: "http://YOUR_CONTROL_PLANE_IP:3001"
pairing_token: "PASTE_THE_TOKEN_HERE"
agent_key_path: "/var/lib/mastermind-agent/agent.key"

heartbeat:
  interval_sec: 5

jobs:
  poll_interval_sec: 5
  long_poll_sec: 30

host:
  name: "my-game-server-host"   # optional display name
```

> In production, `control_plane_url` should use HTTPS.

### Same-box 7DTD autodiscovery

If the agent runs on the same Linux machine as the 7DTD dedicated server, you can let it discover the install and auto-register the server instance.

Add this to `/etc/mastermind-agent/config.yaml`:
```yaml
discovery:
  enabled: true
  seven_dtd:
    enabled: true
    install_path: "/home/xxxxxxx/serverfiles"
    server_config_path: "/home/xxxxxxx/serverfiles/sdtdserver.xml"
    mods_path: "/home/xxxxxxx/serverfiles/Mods"
    saves_path: "/home/xxxxxxxx/.local/share/7DaysToDie/Saves"
    server_admin_xml_path: "/home/xxxxxxxx/.local/share/7DaysToDie/Saves/serveradmin.xml"
    start_command: "/bin/sh /home/xxxxxxx/serverfiles/startserver.sh"
```

What gets discovered:
- From `sdtdserver.xml` / `serverconfig.xml`: server name, telnet port, telnet password, world/save info
- From `Mods/`: mod folder names and mod count
- From `serveradmin.xml`: admin count

On first successful start, the agent will pair, send heartbeats, and auto-create or update the 7DTD server instance for that host.

### Part C: Run the agent

```bash
./mastermind-agent --config /etc/mastermind-agent/config.yaml
```

**What happens on first run:**
1. Agent sends the `pairing_token` to `POST /api/agent/pair`.
2. Control plane validates the token (checks it is unused and not expired), creates a **Host** record, and returns a signed agent JWT.
3. Agent saves the JWT to `agent_key_path` and removes the token from config.
4. Agent begins sending **heartbeats** every 5 seconds (`POST /api/agent/hosts/:hostId/heartbeat`).
5. Agent starts polling for jobs every 5 seconds (`GET /api/agent/hosts/:hostId/jobs/poll`).

After a few seconds, go to **Hosts** in the UI — you should see the host listed with status **Online** and a green indicator.

If 7DTD autodiscovery is enabled, the linked 7DTD server instance should also appear automatically without filling out the Register Server form manually.

### Running the agent as a service (Linux/systemd)

Create `/etc/systemd/system/mastermind-agent.service`:
```ini
[Unit]
Description=Mastermind Game Server Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/mastermind-agent --config /etc/mastermind-agent/config.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now mastermind-agent
journalctl -u mastermind-agent -f   # follow logs
```

### Key rotation

If an agent key is compromised, rotate it:
1. In the UI, go to the host detail page (Hosts → click a host).
2. Click **Rotate Key**. This calls `POST /api/orgs/:orgId/hosts/:hostId/rotate-key`.
3. The old key is immediately invalidated (`agentKeyVersion` incremented).
4. Copy the new key and update the agent's key file, then restart the agent.

---

## 6. Registering a Game Server

Each game host can run multiple game server instances. You register each one in the UI.

### In the UI

1. Go to **Hosts** → scroll to the **Register Server** section (or use the **Hosts** page form).
2. Fill in the fields:

| Field | Required | Description |
|-------|----------|-------------|
| **Name** | Yes | Display name (e.g. "Alpha Server") |
| **Host** | Yes | Select from your paired hosts |
| **Game Type** | Yes | `7dtd` or `minecraft` |
| **Install Path** | Recommended | Full path to the server install directory on the host (e.g. `/opt/7dtd`) |
| **Start Command** | Recommended | Command used to start the server (e.g. `./startserver.sh`) |
| **Telnet Host** | 7DTD only | Telnet host for RCON (usually `127.0.0.1`) |
| **Telnet Port** | 7DTD only | Telnet port (default `8081`) |
| **Telnet Password** | 7DTD only | Telnet password set in `serverconfig.xml` |

3. Click **Register**. The server appears in the list.

### Via API (curl)

```bash
curl -X POST http://localhost:3001/api/orgs/YOUR_ORG_ID/server-instances \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alpha Server",
    "hostId": "HOST_ID",
    "gameType": "7dtd",
    "installPath": "/opt/7dtd",
    "startCommand": "./startserver.sh -configfile=serverconfig.xml",
    "telnetHost": "127.0.0.1",
    "telnetPort": 8081,
    "telnetPassword": "your-telnet-password"
  }'
```

### 7DTD telnet setup

In `serverconfig.xml` on the game server:
```xml
<property name="TelnetEnabled" value="true" />
<property name="TelnetPort" value="8081" />
<property name="TelnetPassword" value="your-telnet-password" />
```

Make sure the telnet port is reachable from the agent process (typically `127.0.0.1` since they run on the same machine).

### Minecraft RCON setup

In `server.properties`:
```properties
enable-rcon=true
rcon.port=25575
rcon.password=your-secure-password
```

Register the server with `telnetHost=127.0.0.1`, `telnetPort=25575`, `telnetPassword=your-rcon-password`. The Minecraft adapter uses the telnet fields as RCON credentials.

---

## 7. Running Jobs (Start / Stop / Restart / RCON)

A **job** is a command sent to a specific game server instance. The control plane enqueues it; the agent picks it up and runs it via the game adapter; then reports back success or failure.

### Job types

| Type | What it does |
|------|-------------|
| `start` | Starts the game server process using `startCommand` |
| `stop` | Stops the game server (graceful via RCON/Telnet, then process kill) |
| `saveworld` | Sends telnet `saveworld` to flush the live world (server must be online) |
| `save-stop` | Sends `saveworld`, copies a full-world backup, then shuts the server down |
| `restart` | Stop then start |
| `rcon` | Send a raw RCON/Telnet command; result returned in job output |
| `custom` | Custom payload; adapter handles based on type string |

### From the UI

1. Go to **Jobs** in the sidebar.
2. Click **Create Job**.
3. Select the **server** from the dropdown (lists all registered server instances).
4. Select the **job type** (`start`, `stop`, `restart`, `rcon`, `custom`).
5. If `rcon`: enter the command in the **Command** field (e.g. `say Hello world`).
6. Click **Submit**.

The job appears in the list with status **Pending**. The page auto-refreshes every 5 seconds. Status changes to **Running** when the agent picks it up, then **Success** or **Failed** when done.

### Recommending mods

Verified organization members (including viewers) can open **Mods → Pending Approval** and upload a ZIP. Mastermind validates `ModInfo.xml` the same way as a staff quarantine upload, then holds the files off the live Mods folder. Administrators and operators can **Approve** (installs into Mods, loads after restart) or **Reject** (deletes the recommendation). Staff can still upload directly to quarantine.

### From the API

```bash
# Restart a server
curl -X POST http://localhost:3001/api/orgs/YOUR_ORG_ID/jobs \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "serverInstanceId": "SERVER_INSTANCE_ID",
    "type": "restart"
  }'

# Send an RCON command
curl -X POST http://localhost:3001/api/orgs/YOUR_ORG_ID/jobs \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "serverInstanceId": "SERVER_INSTANCE_ID",
    "type": "rcon",
    "payload": { "command": "say Server restarting in 5 minutes" }
  }'
```

### What happens internally

```
UI  ──POST /api/orgs/:orgId/jobs──►  Control Plane
                                          │
                                    Creates Job + JobRun (pending)
                                    Enqueues to BullMQ queue jobs:{orgId}
                                          │
Agent polls GET /api/agent/hosts/:hostId/jobs/poll
                                          │
Control Plane returns job data ──────────►│
Agent marks JobRun = running              │
Agent runs game adapter (start/stop/RCON) │
Agent POSTs result ──────────────────────►│
Control Plane marks JobRun = success/failed
```

### Job status meanings

| Status | Meaning |
|--------|---------|
| `pending` | Enqueued; agent has not picked it up yet |
| `running` | Agent is executing it |
| `success` | Completed successfully |
| `failed` | Agent ran the command but it returned an error |
| `cancelled` | Cancelled (e.g. as part of a batch cancel) |

### Viewing job output

In the Jobs list, click on a job row to expand it and see the raw output or error message from the agent.

---

## 8. Scheduled Jobs

Schedules let you run jobs automatically on a cron schedule — for example, a daily server restart at 03:00.

### Schedule fields

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | Display label | "Daily Restart" |
| **Server** | Which server instance | Alpha Server |
| **Cron Expression** | Standard 5-field cron | `0 3 * * *` (03:00 daily) |
| **Job Type** | What to run | `restart` |
| **Enabled** | On/off toggle | true |
| **Execution Window** | Optional time-of-day range | `02:00` – `06:00` |
| **Retry Policy** | Max retries + backoff | `{ maxRetries: 2, backoffMs: 5000 }` |

### Cron expression format

```
┌──────── minute (0-59)
│ ┌────── hour (0-23)
│ │ ┌──── day of month (1-31)
│ │ │ ┌── month (1-12)
│ │ │ │ ┌ day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

Common examples:

| Cron | When |
|------|------|
| `0 3 * * *` | Every day at 03:00 |
| `0 */6 * * *` | Every 6 hours |
| `0 3 * * 1` | Every Monday at 03:00 |
| `30 2 * * 0` | Every Sunday at 02:30 |

### Execution window

If you set an execution window (e.g. start `02:00`, end `06:00`), the scheduler will only fire during that window. If the next cron time falls outside the window, it advances to the next window start (even if that is the next day). Use this to prevent scheduled restarts during peak player hours.

### How scheduling works internally

1. On control plane startup, the scheduler loads all enabled schedules from the database.
2. For each schedule, it calculates `nextRunAt` from the cron expression (clamped to the execution window if set).
3. It enqueues a **delayed BullMQ job** for `nextRunAt`.
4. When that delay expires, the scheduler creates a **Job + JobRun** for the linked server instance and enqueues it to the org job queue — the agent picks it up and runs it as normal.
5. The scheduler then immediately queues the *next* delayed job for the following cron time.

### Managing schedules in the UI

1. Go to **Schedules** in the sidebar.
2. Click **Add Schedule** to create one.
3. Toggle the **Enabled** switch to pause/resume without deleting.
4. Click **Delete** to remove permanently.

> Note: Schedules created in the UI will be persisted to the database. The scheduler service picks them up on its next hydration cycle (startup or if you have a background sweep).

---

## 9. Bulk Operations (Batches)

A **batch** sends the same job to multiple servers at once — useful for rolling restarts or maintenance waves.

### Batch types

| Type | Description |
|------|-------------|
| `restart_wave` | Restart all selected servers |
| `update_wave` | Update all selected servers |
| `bulk_mod_install` | Install a mod on all selected servers |
| `custom` | Any custom job type |

### Creating a batch from the UI (Jobs page)

The **Jobs** page lets you trigger individual jobs. For bulk operations, use the API directly or the future Batches UI section:

```bash
curl -X POST http://localhost:3001/api/orgs/YOUR_ORG_ID/batches \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "restart_wave",
    "serverInstanceIds": ["SERVER_ID_1", "SERVER_ID_2", "SERVER_ID_3"],
    "payload": {}
  }'
```

Response:
```json
{
  "id": "batch_xyz",
  "type": "restart_wave",
  "status": "running",
  "totalCount": 3,
  "pendingCount": 3,
  "runningCount": 0,
  "successCount": 0,
  "failedCount": 0,
  "cancelledCount": 0,
  "createdAt": "2026-03-11T00:00:00Z"
}
```

### Monitoring batch progress

```bash
# Get overall batch status
curl http://localhost:3001/api/orgs/YOUR_ORG_ID/batches/BATCH_ID \
  -H "Authorization: Bearer YOUR_JWT"

# Get per-server job status
curl http://localhost:3001/api/orgs/YOUR_ORG_ID/batches/BATCH_ID/jobs \
  -H "Authorization: Bearer YOUR_JWT"
```

The per-server list shows each server's run status and any error message.

### Batch status meanings

| Status | Meaning |
|--------|---------|
| `running` | At least one server is still pending or running |
| `completed` | All servers finished successfully |
| `completed_with_failures` | Finished, but one or more servers failed |
| `cancelled` | Manually cancelled; running servers finished, pending ones were skipped |

### Cancelling a batch

```bash
curl -X POST http://localhost:3001/api/orgs/YOUR_ORG_ID/batches/BATCH_ID/cancel \
  -H "Authorization: Bearer YOUR_JWT"
```

This cancels all **pending** runs immediately. Runs already in progress (agent is executing) will complete normally.

### Partial failures

If some servers fail, the batch moves to `completed_with_failures`. Each failed job shows an `errorMessage` in the batch jobs list. You can start a new batch with only the failed server IDs to retry them.

---

## 10. Discord Alerts

Mastermind sends Discord notifications when:
- A host goes **offline** (heartbeat missed)
- A server is restarted
- A server goes down

### Setup

1. Create a Discord webhook in your server: **Server Settings → Integrations → Webhooks → New Webhook**. Copy the webhook URL.
2. In the Mastermind UI, go to **Settings**.
3. Paste the webhook URL into **Discord Webhook URL** and save.

The webhook URL is stored per org and is never shown in logs.

### Alert types

| Alert | When it fires |
|-------|--------------|
| `AGENT_OFFLINE` | Host misses heartbeats for more than ~2 minutes |
| `SERVER_RESTART` | After a restart job completes successfully |
| `SERVER_DOWN` | Health check fails or process disappears |

### Rate limiting

Alerts are rate-limited to **10 per 60 seconds per org** to stay within Discord's limits. If your org exceeds this (e.g. many servers going down at once), some alerts may be silently skipped. All alert attempts (including skipped ones) are recorded in the **Audit Log**.

### Testing your webhook

Send a test message from Discord's webhook settings, or trigger a manual restart job and watch Discord.

---

## 11. Roles & Permissions (RBAC)

Every user belongs to an org and has one of three roles:

| Role | Can do |
|------|--------|
| **admin** | Everything: create tokens, rotate keys, CRUD servers, create jobs, manage schedules, manage batches, delete |
| **operator** | Create and trigger jobs, manage server instances, manage schedules and batches; cannot manage pairing tokens |
| **viewer** | Read-only: list servers, view jobs, view batch status; no write actions |

### How roles are assigned

- The **first user** in an org (registered via `/api/auth/register` or via seed) is assigned **admin**.
- Subsequent registrations get **operator** by default.
- Role changes currently require a database update (no UI for role management in MVP).

### Per-endpoint permission matrix

| Endpoint | Viewer | Operator | Admin |
|----------|--------|----------|-------|
| List/view servers | ✓ | ✓ | ✓ |
| Create/edit/delete servers | — | ✓ | ✓ |
| Create jobs | — | ✓ | ✓ |
| View jobs | ✓ | ✓ | ✓ |
| Create/manage schedules | — | ✓ | ✓ |
| Create/cancel batches | — | ✓ | ✓ |
| Generate pairing tokens | — | — | ✓ |
| Rotate agent keys | — | — | ✓ |
| Delete hosts | — | — | ✓ |

---

## 12. Supported Games

### 7 Days to Die

**Supported capabilities:**

| Capability | How it works |
|------------|-------------|
| `start` | Runs `startCommand` (no shell; splits by spaces) |
| `stop` | Kills the server process |
| `restart` | Stop then start |
| `status` | Checks if process is running |
| `send_command` | Sends raw command over Telnet |
| `kick_player` | Sends `kick <playerID>` over Telnet |
| `ban_player` | Sends `ban add <steamId> <duration> <reason>` over Telnet |
| `get_log_path` | Returns `<installPath>/logs/output_log.txt` |

**Requirements:**
- Telnet enabled in `serverconfig.xml`
- `installPath` and `startCommand` configured on the server instance

### Minecraft

**Supported capabilities:**

| Capability | How it works |
|------------|-------------|
| `start` | Runs `startCommand` from `installPath` |
| `stop` | Sends RCON `stop` command |
| `restart` | Stop then start |
| `status` | RCON `list` succeeds → running, fails → stopped |
| `send_command` | Sends raw RCON command |
| `kick_player` | RCON `kick <player>` |
| `ban_player` | RCON `ban <player> [reason]` |
| `get_log_path` | Returns `<installPath>/logs/latest.log` |

**Requirements:**
- RCON enabled in `server.properties` (`enable-rcon=true`, `rcon.port`, `rcon.password`)
- Register with `telnetHost`/`telnetPort`/`telnetPassword` pointing to the RCON endpoint

---

## 13. Troubleshooting

### Web shows "Not connected"

- Verify the control plane is running: `curl http://localhost:3001/health`
- Check `NEXT_PUBLIC_CONTROL_PLANE_URL` in `web/.env.local` matches where the CP is running
- If behind a proxy, make sure CORS is configured (the CP enables CORS for all origins by default in dev)

### Agent fails to pair

- Check the token is not expired (default 15 minutes) — generate a new one
- Verify `control_plane_url` in the agent config is reachable from the host machine
- Check the control plane logs for the specific error (`pnpm dev` output)
- Make sure the token was not already used (single-use; each run generates a new one)

### Agent pairs but shows Offline in UI

- Heartbeats are sent every 5 seconds — check agent logs for heartbeat errors
- Verify the agent can reach the control plane from the game host (not just localhost)
- Check that `JWT_AGENT_SECRET` has not changed since pairing (it would invalidate the stored agent key)

### Jobs stay in Pending forever

- Verify the agent is running and showing Online in the Hosts view
- Check agent logs for poll errors
- Verify Redis is running: `docker compose -f infra/docker-compose.yml ps redis`
- The agent polls every 5 seconds — wait up to 10 seconds after creating a job

### Jobs fail immediately

- Check the job output/error in the Jobs list (click to expand)
- For `start` jobs: verify `startCommand` and `installPath` are correct on the server instance
- For RCON jobs: verify telnet/RCON credentials and that the game server is running and has telnet/RCON enabled
- Check agent logs for the exact error from the game adapter

### Database migration errors

- Ensure Postgres is running and healthy: `docker compose -f infra/docker-compose.yml ps`
- Check `DATABASE_URL` in `control-plane/.env` matches the Compose credentials (`mastermind`/`changeme`/`mastermind`)
- Re-sync schema: `cd control-plane && pnpm prisma db push`

### Login fails with "Invalid email or password"

- Default credentials are `admin@mastermind.local` / `changeme` (only after running the seed)
- Run the seed if you have not: `cd control-plane && npx ts-node prisma/seed.ts`
- If you registered a custom account, ensure the email is exact (case-sensitive)

### Port conflicts

Change the port in `control-plane/.env` (`PORT=XXXX`) and update `NEXT_PUBLIC_CONTROL_PLANE_URL` in `web/.env.local` to match. For Postgres/Redis, change the host-side port in `infra/docker-compose.yml`.

---

## 14. Security Notes

### For development (default setup)

The default setup is **not production-safe**:
- JWT secrets are hardcoded fallbacks (`change-me-user-secret`, `change-me-agent-secret`)
- The pairing controller guards are stubs that allow any request
- No rate limiting on the pairing endpoint

This is intentional for local development. Do not expose the control plane to the internet without addressing the items below.

### Before going to production

**Must-do:**

1. **Set real JWT secrets** — set `JWT_SECRET` and `JWT_AGENT_SECRET` to random 32+ character strings in your environment. Never commit them.

2. **Use HTTPS** — agent communication, pairing tokens, and agent keys must travel over TLS. Put the control plane behind a reverse proxy (nginx, Caddy) with a certificate.

3. **Implement real pairing guards** — the `pairing.controller.ts` stubs (`JwtAuthGuard`, `OrgAdminGuard`) always return `true`. Replace them with the real guards from `server-instances/guards/` before exposing the create-token and rotate-key endpoints.

4. **Add rate limiting** on `POST /api/agent/pair` — e.g. 10 requests per minute per IP — to prevent token brute-force.

5. **Sanitize RCON inputs** — the 7DTD and Minecraft adapters concatenate `playerID` and `reason` directly into RCON commands. Sanitize or restrict allowed characters before production use.

**Recommended:**

- Allowlist the `startCommand` executable in the agent (e.g. only allow `java`, `/opt/7dtd/startserver.sh`)
- Rotate agent keys periodically or after a suspected compromise
- Keep the Discord webhook URL secret — never log it

### Agent security model

The agent only executes commands that come from the control plane via authenticated polling. Commands go through game adapters with defined capability lists — there is no arbitrary shell access by default. The agent identity is verified by JWT on every poll and result submission.

---

## 15. API Quick Reference

All user-facing endpoints require `Authorization: Bearer <token>` from login.
Replace `YOUR_ORG_ID` with your org's ID (visible in Settings or from `GET /api/orgs`).

### Auth

```
POST /api/auth/register      { email, password, name? }  → { access_token, userId, orgId }
POST /api/auth/login         { email, password }          → { access_token, userId, orgId }
GET  /api/auth/me                                         → { userId, email, name, orgs[] }
```

### Orgs

```
GET  /api/orgs                           → list your orgs
POST /api/orgs    { name, slug }         → create org
GET  /api/orgs/:orgId                    → org detail
```

### Hosts

```
GET  /api/orgs/:orgId/hosts              → list hosts (name, status, lastHeartbeat, metrics)
GET  /api/orgs/:orgId/hosts/:hostId      → host detail + server instances
```

### Pairing

```
POST /api/orgs/:orgId/pairing-tokens     { expiresInSec? }  → { id, token, expiresAt }
POST /api/agent/pair                     { pairingToken, hostMetadata? }  → { hostId, agentKey }
POST /api/orgs/:orgId/hosts/:hostId/rotate-key               → { agentKey }
```

### Server Instances

```
GET    /api/orgs/:orgId/server-instances          → list
GET    /api/orgs/:orgId/server-instances/:id      → detail
POST   /api/orgs/:orgId/server-instances          { name, hostId, gameType, installPath, startCommand, telnetHost, telnetPort, telnetPassword }
PATCH  /api/orgs/:orgId/server-instances/:id      (any fields from create, all optional)
DELETE /api/orgs/:orgId/server-instances/:id
```

### Jobs

```
GET  /api/orgs/:orgId/jobs?limit=N       → job list with latest run status
POST /api/orgs/:orgId/jobs               { serverInstanceId, type, payload? }  → { jobId, jobRunId }
```

Job types: `start` | `stop` | `restart` | `rcon` | `custom`
RCON payload: `{ "command": "say hello" }`

### Batches

```
POST /api/orgs/:orgId/batches            { type, serverInstanceIds[], payload? }  → batch summary
GET  /api/orgs/:orgId/batches            → list batches
GET  /api/orgs/:orgId/batches/:id        → batch summary (counts + status)
GET  /api/orgs/:orgId/batches/:id/jobs   → per-server job status list
POST /api/orgs/:orgId/batches/:id/cancel → cancel pending runs
```

Batch types: `restart_wave` | `update_wave` | `bulk_mod_install` | `custom`

### Game Types (public)

```
GET /api/game-types    → list game types with capability arrays (no auth required)
```

### Health

```
GET /health    → { "status": "ok" }
```

---

## End-to-end example flow

Here is the full sequence from zero to a working managed server:

```bash
# 1. Start infrastructure
cd infra && docker compose up -d

# 2. Initialize schema + seed
cd control-plane && pnpm prisma db push && npx ts-node prisma/seed.ts

# 3. Start control plane and web
cd control-plane && pnpm dev &
cd web && pnpm dev &

# 4. Open http://localhost:3000 → login as admin@mastermind.local / changeme

# 5. Generate a pairing token (UI: Hosts → Pair New Host)
#    or via API:
TOKEN=$(curl -s -X POST http://localhost:3001/api/orgs/YOUR_ORG_ID/pairing-tokens \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.token')

# 6. Configure agent on the game host
cat > /etc/mastermind-agent/config.yaml << EOF
control_plane_url: "http://CONTROL_PLANE_IP:3001"
pairing_token: "$TOKEN"
agent_key_path: "/var/lib/mastermind-agent/agent.key"
heartbeat:
  interval_sec: 5
jobs:
  poll_interval_sec: 5
EOF

# 7. Run agent (pairs automatically on first run)
./mastermind-agent

# 8. Register a server instance (UI: Hosts → Register Server)
#    or via API:
curl -X POST http://localhost:3001/api/orgs/YOUR_ORG_ID/server-instances \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alpha",
    "hostId": "HOST_ID_FROM_UI",
    "gameType": "7dtd",
    "installPath": "/opt/7dtd",
    "startCommand": "./startserver.sh",
    "telnetHost": "127.0.0.1",
    "telnetPort": 8081,
    "telnetPassword": "password"
  }'

# 9. Start the server
curl -X POST http://localhost:3001/api/orgs/YOUR_ORG_ID/jobs \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "serverInstanceId": "SERVER_ID", "type": "start" }'

# 10. Check job status
curl http://localhost:3001/api/orgs/YOUR_ORG_ID/jobs \
  -H "Authorization: Bearer YOUR_JWT"
# → latestRun.status: "success"
```

---

## 16. Player portal, shop, and live map

Staff Live Map (`/live-map`) is dashboard-login only. It shows players from PrismaCore (Allocs fallback), hostiles/animals from Allocs, and PrismaCore overlays when ClaimCreator is up. `visitmap` start/stop is an allowlisted Allocs console call; progress is read from the server log.

The player portal is separate:

| Path | Who |
|------|-----|
| `/player/map` | Terrain, zombies, and animals are public. Other players appear only after Steam OpenID. |
| `/player/shop` | Public catalog. Donate with Steam or an in-game-name password account. Item pages list any In-Game Gifts (thank-you gifts after donation — not item purchases). |
| `/player/profile` | Steam sessions only. |

Staff **Players** uses a card layout and can set an online player's death count (ServerTools). Donator-shop admins can attach optional In-Game Gifts and chat color; delivery status appears under **Donations**.

Do not expose Allocs `:8080`, PrismaCore `:11111`, or telnet on the public internet. Shop status may show an online-player count, not names or positions.

---

*Guide updated 2026-08-20 (shop grants display, Set deaths, players cards).*

