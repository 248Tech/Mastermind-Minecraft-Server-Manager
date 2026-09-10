# Minecraft adapter — required server config

The Minecraft game adapter (agent-side) uses **RCON** for commands and **process control** for start/stop. Mod **listing** is supported; full quarantine/upload parity with the 7DTD adapter is still expanding.

## Capability registration (control plane)

The **minecraft** game type should advertise:

- `start`, `stop`, `restart`, `status`, `send_command`, `kick_player`, `ban_player`, `get_log_path`, `install_mod`

Seeded by `control-plane/prisma/seed.ts` (Minecraft is listed first).

## Required server instance fields

Stored on **server_instances** (and passed in job payload to the agent). For Minecraft, **telnet_*** fields are used as **RCON** (host, port, password).

| Field | Required | Description |
|-------|----------|-------------|
| **install_path** | Yes | Server root (contains `server.properties`, `logs/`, usually `mods/` or `plugins/`). |
| **start_command** | Recommended | e.g. `java -Xmx8G -jar server.jar nogui` or a pack launcher `.bat`/`.sh` in the server root. |
| **update_command** | For `SERVER_UPDATE` | Pack/host update script (not Steam). Set via Manage UI (`updateCommand`) or `config.update_command`. |
| **telnet_host** | Yes (for RCON) | RCON host (usually `127.0.0.1`). |
| **telnet_port** | Yes (for RCON) | Default `25575`. |
| **telnet_password** | Yes (for RCON) | Must match `rcon.password` in `server.properties`. |
| **stop_command** | No | Optional OS stop script; otherwise RCON `stop`. |
| **map_embed_url** | No | BlueMap/Dynmap/Squaremap iframe URL. Discovery may set a hint only when this is empty. |

## server.properties

```properties
enable-rcon=true
rcon.port=25575
rcon.password=your-secure-password
```

## Autodiscovery

Agent config / env:

```yaml
discovery:
  enabled: true
  minecraft:
    enabled: true
    install_path: "C:/path/to/your/minecraft-server"
    # start_command: "C:/path/to/your/minecraft-server/run.bat"  # optional
```

Env equivalents: `MASTERMIND_MC_DISCOVERY_ENABLED`, `MASTERMIND_MC_INSTALL_PATH`, `MASTERMIND_MC_SERVER_PROPERTIES`, `MASTERMIND_MC_START_COMMAND`, `MASTERMIND_MC_NAME`, …

Discovery syncs name (from MOTD), RCON port/password, world/level name, mod/plugin counts, and optional `map_embed_hint` when BlueMap/Dynmap/Squaremap is detected. Control plane applies the hint to `map_embed_url` only if that field is still empty.

## Job types (agent)

| Job | Behavior |
|-----|----------|
| `SERVER_START` / `STOP` / `RESTART` / `KILL` | Process + RCON lifecycle |
| `SERVER_UPDATE` | Runs `update_command` from install root (fails if unset) |
| `SERVER_SAFE_RESTART` | Countdown `say`, `save-all`, kick, stop, start |
| `SERVER_SAVEWORLD` | `save-all` |
| `STATUS` | RCON `list` reachability |
| `RCON` / `SEND_COMMAND` | Raw console command |
| `LIST_PLAYERS` / `PLAYER_LIST_SYNC` | Parsed player names from `list` |
| `PLAYER_KICK` / `PLAYER_KICK_ALL` / `PLAYER_BAN` | Kick/ban |
| `PLAYER_ADMIN_PROMOTE` / `DEMOTE` | `op` / `deop` |
| `SERVER_CONFIG_READ` / `WRITE` | `server.properties` |
| `SAVE_BACKUP` | Copy world folder under `mastermind-backups/` |
| `SERVER_WIPE_SAVE` | Delete world (requires `confirmed: true`) |
| `MOD_LIST` | List jars under `mods/` / `plugins/` (`folder` = jar filename) |
| `MOD_QUARANTINE` / `MOD_APPROVE` / `MOD_RESTORE` / `MOD_DELETE` | Jar quarantine path; ZIP uploads extract jars; `forceOverride` on restore |
| `MOD_CONFIG_MERGE_PREVIEW` / `MOD_CONFIG_MERGE_APPLY` | Config merge when templates exist |

## Alerts

Log keyword rules can emit Discord alerts with type `LOG_KEYWORD` when the agent tails `logs/latest.log` (auto-enabled after discovery).

## Player list

RCON `list` output is parsed for common Paper/Vanilla formats, e.g. `There are 2 of a max of 20 players online: Alice, Bob`.
