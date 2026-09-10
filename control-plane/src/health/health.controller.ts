import * as fs from 'fs';
import * as path from 'path';
import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { sanitizeInstallToken, sanitizeInstallUrl } from '../common/install-script';

const pkg = { name: 'mastermind-control-plane', version: '0.0.15' };

@Controller()
export class HealthController {
  @Get()
  getRoot() {
    return {
      service: 'Mastermind Minecraft Server Manager — Control Plane',
      version: pkg.version,
      status: 'ok',
      at: new Date().toISOString(),
      endpoints: {
        health: 'GET /health',
        docs: 'GET /docs',
        auth: {
          register: 'POST /api/auth/register',
          login: 'POST /api/auth/login',
          profile: 'GET /api/auth/profile',
        },
        orgs: {
          list: 'GET /api/orgs',
          create: 'POST /api/orgs',
          get: 'GET /api/orgs/:orgId',
          update: 'PATCH /api/orgs/:orgId',
        },
        hosts: {
          list: 'GET /api/orgs/:orgId/hosts',
          get: 'GET /api/orgs/:orgId/hosts/:hostId',
          heartbeat: 'POST /api/agent/heartbeat',
        },
        pairing: {
          generate: 'POST /api/orgs/:orgId/pairing-tokens',
          register: 'POST /api/agent/register',
        },
        serverInstances: {
          list: 'GET /api/orgs/:orgId/server-instances',
          create: 'POST /api/orgs/:orgId/server-instances',
          get: 'GET /api/orgs/:orgId/server-instances/:id',
          update: 'PATCH /api/orgs/:orgId/server-instances/:id',
          delete: 'DELETE /api/orgs/:orgId/server-instances/:id',
        },
        jobs: {
          list: 'GET /api/orgs/:orgId/jobs',
          create: 'POST /api/orgs/:orgId/jobs',
          agentPoll: 'GET /api/agent/jobs/poll',
          agentAck: 'POST /api/agent/jobs/:jobRunId/ack',
        },
        schedules: {
          list: 'GET /api/orgs/:orgId/schedules',
          create: 'POST /api/orgs/:orgId/schedules',
          update: 'PATCH /api/orgs/:orgId/schedules/:id',
          delete: 'DELETE /api/orgs/:orgId/schedules/:id',
        },
        alerts: {
          list: 'GET /api/orgs/:orgId/alerts',
          create: 'POST /api/orgs/:orgId/alerts',
          update: 'PATCH /api/orgs/:orgId/alerts/:id',
          delete: 'DELETE /api/orgs/:orgId/alerts/:id',
        },
        triggers: {
          list: 'GET /api/orgs/:orgId/triggers',
          create: 'POST /api/orgs/:orgId/triggers',
          update: 'PATCH /api/orgs/:orgId/triggers/:id',
          delete: 'DELETE /api/orgs/:orgId/triggers/:id',
        },
        gameTypes: 'GET /api/game-types',
        agentInstall: 'GET /install.sh?token=TOKEN&url=URL&name=NAME',
      },
    };
  }

  @Get(['health', 'api/health'])
  getHealth() {
    return { status: 'ok', service: 'control-plane', at: new Date().toISOString() };
  }

  @Get('docs')
  getDocs() {
    return { message: 'API docs (Swagger/OpenAPI) — add @nestjs/swagger for full spec', health: '/health' };
  }

  /**
   * Serves a self-contained bash setup script for the Mastermind agent.
   * Usage: curl -sSL "http://<cp>:3001/install.sh?token=TOKEN&url=http://<cp>:3001&name=my-server" | sudo bash
   */
  @Get('install.sh')
  getInstallScript(
    @Query('token') token = '',
    @Query('url') cpUrl = '',
    @Query('name') hostName = '',
    @Res() res: Response,
  ) {
    const safeName = hostName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'my-server';
    const safeCpUrl = sanitizeInstallUrl(cpUrl) || 'http://CHANGE_ME:3001';
    const safeToken = sanitizeInstallToken(token);

    const script = `#!/usr/bin/env bash
# Mastermind Agent — auto-generated setup script
# Control plane: ${safeCpUrl}
# Token expires in ~10 minutes; run this promptly.
set -e

MASTERMIND_CP_URL="\${MASTERMIND_CP_URL:-${safeCpUrl}}"
MASTERMIND_PAIRING_TOKEN="\${MASTERMIND_PAIRING_TOKEN:-${safeToken}}"
MASTERMIND_HOST_NAME="\${MASTERMIND_HOST_NAME:-${safeName}}"
CONFIG_DIR="/etc/mastermind-agent"
DATA_DIR="/var/lib/mastermind-agent"

echo ""
echo "  Mastermind Agent Setup"
echo "  Control Plane : \$MASTERMIND_CP_URL"
echo "  Host Name     : \$MASTERMIND_HOST_NAME"
echo ""

# ── Write config file ────────────────────────────────────────────────────────
mkdir -p "\$CONFIG_DIR" "\$DATA_DIR"
cat > "\$CONFIG_DIR/config.yaml" <<YAML
control_plane_url: "\$MASTERMIND_CP_URL"
pairing_token: "\$MASTERMIND_PAIRING_TOKEN"
agent_key_path: "\$DATA_DIR/agent.key"
heartbeat:
  interval_sec: 5
jobs:
  poll_interval_sec: 5
  long_poll_sec: 30
host:
  name: "\$MASTERMIND_HOST_NAME"
YAML
chmod 600 "\$CONFIG_DIR/config.yaml"
echo "  ✓ Config written to \$CONFIG_DIR/config.yaml"

# ── Run via Docker if available ───────────────────────────────────────────────
if command -v docker &>/dev/null; then
  echo "  ✓ Docker found — starting agent container"
  docker stop mastermind-agent 2>/dev/null || true
  docker rm   mastermind-agent 2>/dev/null || true
  docker run -d \\
    --name mastermind-agent \\
    --restart unless-stopped \\
    -e MASTERMIND_CP_URL="\$MASTERMIND_CP_URL" \\
    -e MASTERMIND_PAIRING_TOKEN="\$MASTERMIND_PAIRING_TOKEN" \\
    -e MASTERMIND_HOST_NAME="\$MASTERMIND_HOST_NAME" \\
    -v mastermind-agent-data:"\$DATA_DIR" \\
    mastermind-agent
  echo ""
  echo "  Agent started. It will appear in the Mastermind UI within a few seconds."
  echo "  Logs: docker logs -f mastermind-agent"
  exit 0
fi

# ── Fallback: build from source if Go is available ───────────────────────────
if command -v go &>/dev/null; then
  echo "  Docker not found — attempting to build from source (requires repo)"
  if [ ! -f "./agent/main.go" ] && [ ! -f "./main.go" ]; then
    echo ""
    echo "  ERROR: Go is available but the Mastermind agent source was not found."
    echo "  Either clone the repo and re-run, or install Docker first."
    echo ""
    echo "  Config is ready at \$CONFIG_DIR/config.yaml"
    echo "  Once you have the binary: ./mastermind-agent -config \$CONFIG_DIR/config.yaml"
    exit 1
  fi
  SRC_DIR="."
  [ -f "./agent/main.go" ] && SRC_DIR="./agent"
  echo "  Building agent in \$SRC_DIR ..."
  (cd "\$SRC_DIR" && go build -o /usr/local/bin/mastermind-agent ./...)
  echo "  ✓ Built /usr/local/bin/mastermind-agent"

  # Install systemd service if available
  if command -v systemctl &>/dev/null; then
    cat > /etc/systemd/system/mastermind-agent.service <<UNIT
[Unit]
Description=Mastermind Game Server Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/mastermind-agent -config /etc/mastermind-agent/config.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now mastermind-agent
    echo "  ✓ Systemd service enabled and started"
  else
    /usr/local/bin/mastermind-agent -config "\$CONFIG_DIR/config.yaml" &
    echo "  ✓ Agent started in background (PID \$!)"
  fi
  echo ""
  echo "  Agent started. It will appear in the Mastermind UI within a few seconds."
  exit 0
fi

# ── Neither Docker nor Go ─────────────────────────────────────────────────────
echo ""
echo "  ERROR: Neither Docker nor Go was found on this machine."
echo "  Install Docker (https://docs.docker.com/get-docker/) then re-run this script."
echo ""
echo "  Config has been written to \$CONFIG_DIR/config.yaml"
echo "  Once you have the agent binary:"
echo "    ./mastermind-agent -config \$CONFIG_DIR/config.yaml"
exit 1
`;

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="install.sh"');
    res.send(script);
  }

  /**
   * Serves pre-built agent binaries built by scripts/start.sh.
   * Binaries live at control-plane/public/agents/<filename>.
   *
   * Platforms:
   *   linux-amd64, linux-arm64, darwin-amd64, darwin-arm64, windows-amd64
   *
   * Usage:
   *   curl -LO "http://<cp>:3001/agent/download/linux-amd64"
   */
  @Get('agent/download/:platform')
  downloadAgent(@Param('platform') platform: string, @Res() res: Response) {
    const PLATFORM_FILES: Record<string, string> = {
      'linux-amd64':   'mastermind-agent-linux-amd64',
      'linux-arm64':   'mastermind-agent-linux-arm64',
      'darwin-amd64':  'mastermind-agent-darwin-amd64',
      'darwin-arm64':  'mastermind-agent-darwin-arm64',
      'windows-amd64': 'mastermind-agent-windows-amd64.exe',
    };

    const filename = PLATFORM_FILES[platform];
    if (!filename) {
      throw new NotFoundException(
        `Unknown platform "${platform}". Valid: ${Object.keys(PLATFORM_FILES).join(', ')}`,
      );
    }

    // Binaries are written to control-plane/public/agents/ by scripts/start.sh
    const agentsDir = path.join(process.cwd(), 'public', 'agents');
    const filePath = path.join(agentsDir, filename);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(
        `Agent binary for "${platform}" is not available yet. Run scripts/start.sh to build it.`,
      );
    }

    const stat = fs.statSync(filePath);
    const isWindows = platform.startsWith('windows');
    const downloadName = isWindows ? 'mastermind-agent.exe' : 'mastermind-agent';

    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.set('Content-Length', String(stat.size));
    fs.createReadStream(filePath).pipe(res);
  }
}
