# Changelog

## [0.11.0] - 2026-09-10

### Removed

- Player `entityId`, `lastInventory`, and `lastInventoryAt` (migration `20260910000006_drop_player_inventory_entity`).
- 7DTD bag/belt inventory parsers (`player-inventory`) and dashboard `InventoryGrid`.
- Inventory snapshot job persistence path.

### Changed

- Player inventory API returns **410 Gone**.
- Roster position merge no longer keys on entity id.

## [0.10.0] - 2026-09-10

### Removed

- Player portal places / vehicles / POI / map-entity Gone stubs and web proxies.
- 7DTD `lp` / Allocs roster parsers; Minecraft `PLAYER_LIST_SYNC` is the only path.
- `Player.playerKills` column (migration `20260910000005_drop_player_kills`).
- Grant `quality` from shop/trigger types and RCON `give` builders (legacy JSON keys ignored).

### Changed

- Roster identity helpers are Minecraft/Steam oriented without PvP kill counters.

## [0.9.0] - 2026-09-10

### Removed

- Player `eosId`, `zombieKills`, and `PlayerVehicleHistory` (migration `20260910000004_drop_7dtd_player_shop_residue`).
- Shop/donation columns `grantQuality`, `chatColor`, `bonusLandClaims`, `chatColorStatus`.
- Donated land-claims helper and chat-color grant delivery paths.

### Changed

- Player roster sync and identity reconcile are Minecraft/Steam oriented (no EOS counters).
- Donator shop and purchases APIs no longer expose 7DTD grant-color / land-claim fields.

## [0.8.0] - 2026-09-10

### Removed

- Frigate NVR integration (module, webhook, org settings/test endpoint, alert type).
- `Org.frigate_*` and `Org.avoidBloodMoonRestart` columns (migration `20260910000003_drop_legacy_integrations`).

### Changed

- Triggers grant UI/copy is Minecraft-native (no quality suffix); grant configs persist `quality: null`.
- Portable Redis must be ≥ 6.2; `scripts/install-portable-redis.ps1` installs Redis 7.0.15; `start-local-infra.ps1` fails fast on older builds.
- `restart-stack.ps1` health check uses `/api/health` and starts CP/web via `pnpm` redirects (more reliable on Windows).

## [0.7.0] - 2026-09-10

### Added

- `scripts/install-agent-service.ps1` — Windows Scheduled Task to start the host agent at boot/logon.

### Changed

- Donator shop admin UI is Minecraft-native: RCON `give` gifts only (no quality, chat color, or land-claim fields).
- Shop item saves clear legacy chat-color / land-claim columns; donation grant delivery skips chat-color jobs.

## [0.6.0] - 2026-09-10

### Added

- `scripts/restart-stack.ps1` — restart portable Postgres/Redis + control-plane + web (+ optional agent).
- `scripts/prod-up.ps1` — production Docker Compose bring-up with optional migrate / cloudflared / discord-bot profiles.
- `docs/production-deploy.md` — Docker vs Windows-portable production checklist (agent always on game host).

### Changed

- Cloudflare tunnel Compose service is opt-in (`--profile cloudflared`) so default `compose up` no longer requires a tunnel token file.
- README quickstart points at `infra/.env.example` and production deploy docs.

## [0.5.0] - 2026-09-10

### Added

- Minecraft `PLAYER_LIST_SYNC` consumes structured agent `result.players` (name/UUID identity).

### Changed

- Join/leave log parsing is Minecraft-only; prefers `uuid:` identity and Discord alerts show Player + UUID.
- Discord alert footer branded for Minecraft; Steam/EOS fields omitted when UUID is present.
- Player portal profile drops bag/belt inventory UI; support copy is account-neutral.
- Worlds/Saves table drops 7DTD “Game day” column.
- Places / vehicles / POI player-auth routes return **410 Gone**.

### Deprecated

- `Org.avoidBloodMoonRestart` marked unused (column retained).

## [0.4.0] - 2026-09-10

### Added

- NeoForge **config merge**: `MOD_CONFIG_READ` / `WRITE` / `MERGE_PREVIEW` / `MERGE_APPLY` for install paths under `config/` and `defaultconfigs/`.
- Jar → modId discovery (`neoforge.mods.toml`) with config file listing on active mods.
- Quarantine template staging under `mods/.quarantine/.config-templates/{jar}/` (jar defaults + pack defaultconfigs + live snapshots).
- Ported additive `configmerge` engine (TOML/INI/JSON/XML); SNBT listed with skip warning.

### Changed

- Mods UI copy is jar/`config/{modId}` oriented (no 7DTD `{Mod}_Config` sibling wording).

## [0.3.0] - 2026-09-10

### Added

- Per-instance **pack update command** (`updateCommand` / `config.update_command`) editable in Manage; required for `SERVER_UPDATE`.
- BlueMap/Dynmap/Squaremap **map embed hint** on discovery (fills `mapEmbedUrl` only when unset).
- Mod ZIP uploads extract `.jar` files into quarantine/pending; list/actions use jar name as `folder`.
- `MOD_RESTORE` supports `forceOverride` when replacing an active jar.
- Log keyword matches can fire Discord alerts (`LOG_KEYWORD`).

### Changed

- Landing/portal copy is Minecraft-first (no 7DTD places/vehicles card).
- Log keyword placeholder uses Minecraft examples.

## [0.2.2] - 2026-09-10

### Added

- Process-based Stop/Kill fallback: after RCON `stop`, force-terminate listeners on game/RCON ports when needed.
- Auto log tail of `logs/latest.log` after Minecraft discovery (no manual logs config required).
- Windows bring-up scripts: `scripts/bring-up.ps1`, `scripts/start-local-infra.ps1`, `scripts/run-agent.ps1` (env-driven paths, no hardcoded installs).
- `SAVE_BACKUP` result includes `save.id` for the Worlds UI.

### Fixed

- Windows discovery prefers `.bat`/`.cmd` launchers over `.sh`.
- Operator-facing copy: RCON (not Telnet), Minecraft-only host help, health service name.

## [0.2.1] - 2026-09-10

### Changed

- **Players** dashboard is Minecraft-native: name/UUID roster, kick/ban/op/deop by name, ops.json operators; removed Steam/EOS/zombie kills/inventory/set-deaths.
- **Player portal** prefers Minecraft name sign-in/register; Steam is optional. Name sessions can donate (RCON `give` gifts).
- Donator shop copy uses RCON `give` instead of 7DTD `giveplus`.

## [0.2.0] - 2026-09-10

### Removed

- Retired the entire **7 Days to Die** stack: agent `7dtd` adapter/discovery, Allocs/PrismaCore/POI/vehicles control-plane modules, profile editor / region healer / POI search UI, Allocs tile map APIs, item-icon proxies, telnet-relay, and related infra/integration scripts.

### Added

- Minecraft agent parity jobs: mod quarantine/pending, world save list/restore/retention, maintenance mode, pack `update_command`, `ops.json` admin list, `TRIGGER_GRANT_ITEMS`, log chat stream.
- Live Map as BlueMap/Dynmap/Squaremap **embed URL** (`mapEmbedUrl` on server instances).
- Shop/trigger grants via RCON `give <player> <item> <count>`; Minecraft join/leave/chat log parsers; UUID/name roster polling.

### Changed

- Product is **Minecraft-only**. Discovery, job types, triggers (grant items), and Docker Compose no longer wire 7DTD services or env vars.
- Server instance `gameType` defaults to and validates as `minecraft`.

## [0.1.0] - 2026-09-10

### Added

- Forked as **Mastermind Minecraft Server Manager** from the 7DTD control-plane lineage.
- Expanded Minecraft agent adapter: safe restart, save-all, kick/ban/op/deop, `server.properties` read/write, world backup/wipe, mod/plugin listing, parsed `list` players.
- Minecraft autodiscovery from `server.properties` (`discovery.minecraft` / `MASTERMIND_MC_*` env).

### Changed

- Product branding, seed order, and dashboard defaults target **minecraft** first.
- Navigation hides 7DTD-only surfaces (POI Search, Live Map, Profile Editor, Region Healer) from the primary Minecraft nav.

## [0.0.15] - 2026-09-09

### Added

- Added selected-server **POI Search**. The agent indexes safe native prefab names from the installed 7DTD `Data/Prefabs/POIs` folder, the dashboard and authorized player portal filter the catalog, and a preview is transferred only when requested.
- Added constrained `SERVER_CONFIG_READ` / `SERVER_CONFIG_WRITE` jobs and a ServerConfig editor to the server manager using the shared configuration-editor interface.
- Added supporter/admin player-portal pages to browse and download active mods, and to search the selected server's POIs.
- Added safer mod-update tooling for quarantined conflicts: explicit replacement, template-aware configuration merge previews, and reviewed carry-forward of compatible XML/INI/text settings.

### Changed

- Extended persisted server selection across the new dashboard and player-portal surfaces, keeping server-scoped data and actions explicit.
- Hardened 7DTD service/config ownership, profile staging/injection, ServerTools runtime config handling, and agent image builds for multi-package Go source layouts.
- Updated release context, feature documentation, and package/health metadata for `0.0.15`.

### Security

- POI names are constrained before filesystem access; catalog/result payloads and preview sizes are bounded. Preview images are never bulk-exported from the game host.
- ServerConfig and mod writes remain authenticated, server-bound, path-constrained agent jobs; player downloads remain limited to active mods and authorized supporter/admin sessions.

## [0.0.14] - 2026-08-27

### Added

- Added server-aware navigation and persisted server selection across operational pages, so multi-server operators can explicitly target the intended 7DTD instance.
- Added managed stable-build updates (`SERVER_UPDATE`) for 7DTD. Mastermind checks Steam, performs a safe save/stop/update/start sequence when required, and can check for a stable build before the host starts the server.
- Added configurable Mastermind-owned Stability Safe Restart policy: enable/disable, 4–64 GiB RAM threshold, and 30-minute to 24-hour cooldown. The VM watcher reports memory to Mastermind; it no longer directly restarts 7DTD.
- Added one-time scheduled-reboot suppression. A successful stability restart skips the nearest automatic reboot, and operators can use **Skip next auto reboot** from the server page.
- Added level-based automation triggers for land-claim rewards and item grants, including safe `grantitems` handling and donated land-claim reward support.
- Added tracked player vehicles with staff return controls and player-portal visibility where permitted.
- Added Mod-page search/filtering and expanded Mod Config access to safe runtime `{Mod}_Config` files such as `ServerTools_Config`.

### Changed

- ServerTools-compatible mod configuration and player/save handling were hardened for current 7DTD builds.
- README and release context now describe the current multi-server, stability, update, automation, and player features.

### Security

- Stability decisions remain authenticated and server-bound. Only Mastermind queues restart jobs, preserving countdown/save/backup/Blood Moon checks, cooldowns, and job history.
- Automatic reboot suppression applies only to the nearest enabled restart schedule for the same server and clears after that occurrence.

## [0.0.12] - 2026-08-18

- Added the Steam-aware player portal, live map layers, player profiles, map history/trails, claims, inventory/stat displays, and supporter/shop flows.
- Added Mailgun confirmation, account approval, Steam-link indicators, administrator portal links, escalating login protection, registration quotas, reCAPTCHA support, and encrypted Cloudflare/DigitalOcean settings.
- Added Allocs/PrismaCore live-data integrations and preserved server-side handling of webtokens and credentials.
- Reworked the mod editor into an IDE-style editor with tabs, line numbers, syntax coloring, search, wrapping, keyboard save, and AI diff approval.
- Fixed ServerTools inventory stack quantities being displayed as one item; `Slot N: quantity * item` and common Allocs quantity fields are now preserved.
- Continued safe restart/save/mod/profile/chat/alert/health/log/Discord operations and agent resilience improvements.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Post-0.0.11 portal/shop/Allocs/PrismaCore work shipped in `0.0.12` (2026-08-18). The items below are **already live in production** as of 2026-08-20; see [docs/live-features-2026-08-20.md](docs/live-features-2026-08-20.md). They are not a pending deploy checklist.

### Added

- Donator-shop optional In-Game Gifts (item/qty/quality) and donor chat color; donation snapshots and delivery status; sanitized telnet `giveplus` / `playerchatcolor` with offline retry. Copy frames gifts as thank-you gifts after donation — not item purchases.
- Player shop pages show In-Game Gifts with `/item-icon/{name}` icons; admin gift autocomplete from ItemIcons + agent `ITEM_CATALOG` (items and blocks, including `keystoneBlock`).
- Staff **Set deaths** (`PLAYER_SET_DEATHS` → ServerTools `st-SetDeaths`) with a short control-plane pin after success.
- Server controls **Save world** (`SERVER_SAVEWORLD` → telnet `saveworld`) and **Save-stop** (`SERVER_SAVE_STOP`: saveworld, full-world backup, then shutdown).
- Verified members can recommend mods from the Mods page. Uploads land in **Pending Approval** until staff approve them into Mods or reject them.
- Manager **Status** button shows Online / Offline / Maintenance. Staff can enter or leave maintenance: the password from Settings is written to `serverconfig.xml` `ServerPassword`, then the server does a safe restart.

### Changed

- Players page uses a responsive card layout (no wide horizontal table scroll).
- Live-map client keeps player-track hooks above early returns (fixes a React hooks crash).
- Agent item catalog scans vanilla/mod `items.xml` and `blocks.xml` plus ItemIcons; shop open can force a fresh catalog load.
- Mod config writes use direct writable-file fallbacks and safer replacement; pending-restart markers remain on the live agent.
- Mods Config editor now lists runtime files ServerTools writes into `Mods/ServerTools_Config` (CommandList, Phrases, Motd, and the rest), not only files named config/settings inside the dll folder. Editor limit is 256 KiB.

### Security

- Shop In-Game Gifts remain server-built `giveplus` / `playerchatcolor` only. Item names are charset-limited; `giveplus all` is never sent.

## [0.0.11] - 2026-08-14

### Added

- Added Kimi Code as a selectable Mod Editor agent alongside Codex, with encrypted Moonshot API-key storage, model selection, live connection testing, provider attribution, and the existing mandatory proposal/diff approval boundary.
- Added native chat moderation with an editable blocked-word directory, per-rule log/warn/kick actions, flood thresholds, mute/unmute controls, audited enforcement, and suppression of moderated messages from Discord relay.
- Added authenticated ZIP mod uploads up to 256 MiB. Archives are validated against traversal, symlinks, ambiguous nested mods, file-count/expanded-size limits, redundant `Mods`/wrapper folders, duplicate targets, and unsafe permissions before being placed in quarantine.
- Added live-map generation controls based on `map_info.xml`, including configurable section generation, explicitly warned full-world generation, current `visitmap` state/progress, and verified stop behavior.
- Added queued/applied profile-injection status and timestamps to the Profile Editor.
- Added lightweight agent operational instrumentation for goroutines, job concurrency/totals, heartbeat and poll failures, log throughput/failures, and in-memory backlog.

### Changed

- Reworked the Go log tailer to keep the server log open, follow truncation/rotation/replacement/deletion, batch at 64 KiB or 350 ms, retry failed chunks in order, and upload direct byte slices without the former reader/read-all copy.
- Configured pooled HTTP transports and request-specific deadlines so normal requests remain bounded while long polls receive their configured duration plus network grace.
- Added bounded exponential backoff with jitter to heartbeat, job polling, and log delivery failures.
- Bounded explicitly audited read-only jobs with `jobs.max_concurrent_reads` (default 8, maximum 64) and serialized arbitrary RCON/SEND_COMMAND jobs in both agent and control-plane classification.
- Removed the hard-coded `127.0.0.1:26900` host probe; reachability now uses the discovered/configured 7DTD endpoint on a slower cadence.
- Added build-time agent version reporting, cached static host metadata, SIGTERM-aware shutdown, safe empty-poll pacing, long-poll validation, and stale-running-job recovery.
- Scheduler occurrences now skip when the same schedule already has pending/running work instead of stacking duplicate long operations.
- Bumped repository, control-plane, web, health endpoint, and provider user-agent versions to `0.0.11`.

### Fixed

- Fixed live-map maximum zoom-out disappearing by aligning tile-layer and map minimum zoom.
- Fixed stale Map Generation controls that claimed generation was active after `visitmap` had ended.
- Fixed missing profile injection feedback by deriving queued/applied state from the agent staging and backup metadata.
- Fixed active player polling continuing against known-unreachable game hosts.
- Fixed successful empty job polls becoming a tight API request loop on control planes that return immediately.

### Security

- Kimi and OpenAI credentials remain encrypted and server-side; neither provider key is returned to browsers.
- Mod uploads are agent-authenticated, host-bound, short-lived, size-bounded, ZIP-signature checked, path constrained, symlink rejected, and removed after job completion.
- Machine-specific sudoers policy remains excluded from the public repository.

## [0.0.10] - 2026-08-13

### Added

- Added Codex-assisted mod configuration editing through the OpenAI Responses API, encrypted API-key storage, configurable Codex models, live connection testing, structured edit proposals, line-by-line diffs, and mandatory approval before saving.
- Added per-server high-ping kicking with configurable threshold, required consecutive samples, reason, cooldown, and minute-based enforcement.
- Added country-based connection enforcement with ISO country-code lists, kick/ban selection, duration/reason controls, lookup caching, and safe skipping of private or relay-masked addresses.
- Added player IP address capture from authoritative `lp` output, player level, zombie kills, player kills, deaths, and inventory inspection.
- Added player search, online/offline/admin filters, sorting, summary cards, manual refresh feedback, and responsive mobile player cards.
- Added player-name association to Profile Editor entries by matching EOS/Steam profile filenames against the active save's `players.xml`.
- Added administrator password resets for lower-tier organization accounts without exposing or requiring their original password.

### Changed

- Region-grid labels now come from actual `.7rg` filenames found in the active save and remain visible for every displayed region.
- OpenAI connection testing now sends a real Responses API request instead of trusting model-list presence. Default supported model changed from the listed-but-unusable `gpt-5-codex` alias to verified `gpt-5.3-codex`.
- Bumped repository, control-plane, web, and health endpoint versions to `0.0.10`.

### Security

- OpenAI API keys remain control-plane-only, are encrypted with AES-256-GCM at rest, never returned to browsers, and can be tested, replaced, or removed only by organization administrators.
- AI-generated mod edits never write automatically. Users must inspect and approve the diff, then explicitly save through the existing constrained atomic config-write job.

## [0.0.9] - 2026-08-12

### Added

- Added an authenticated live 7DTD map using official rendered terrain tiles, live players, animals, hostiles, coordinates, game time, and region-grid overlays.
- Added owned land-claim block markers and protection rectangles parsed from the active save.
- Added browser-local map history with selectable 5-minute through 72-hour windows, timeline scrubbing, player-specific tracking, and selectable highlighted trail colors.
- Integrated RussDev7's GPL-3.0 7D2D Profile Editor as an isolated service with visible credit, server profile discovery, staged editing, TTP validation, timestamped original archives, and atomic apply-on-next-start handling.
- Added an administrator-only Accounts page for creating operator/viewer accounts and removing organization access while retaining historical attribution.
- Added Original, Dark, and Light UI themes stored per browser.

### Changed

- Reorganized the sidebar into scrollable Overview, Server, Automation, and System groups for compact and mobile layouts.
- Expanded Discord bot instructions for users without technical or Discord experience, including exact file locations and an Accounts-page workflow for creating the bot login.
- Bumped repository, control-plane, web, and health endpoint versions to `0.0.9`.

### Fixed

- Server-authored `say` messages are now parsed into the Chat page as `Server` while remaining excluded from the player-only Discord relay.
- Profile staging is applied only while 7DTD is fully stopped and preserves both original `.ttp` and companion `.ttp.bak` files with audit metadata.

## [0.0.8] - 2026-08-11

### Added

- Added an optional downloadable Discord bot with `/start`, `/stop`, `/reboot`, and `/safereboot` commands, Mastermind job completion/failure replies, dedicated-account attribution, and Discord role/user authorization.
- Added beginner-oriented Discord bot setup and credential instructions to Settings, a copyable environment template, standalone/Docker packaging, and an optional Compose profile.
- Added constrained mod configuration discovery, reading, and atomic saving for supported text formats up to 64 KiB, with traversal and symlink protections.
- Added session playtime to Player Disconnected Discord messages.

### Changed

- Deprecated Frigate in the current UI by removing its Settings card and new-alert option while preserving backend support and stored configuration.
- Interactive RCON and read-only player queries can run concurrently while a long Safe Restart waits for Blood Moon protection.
- Bumped repository, control-plane, web, and health endpoint versions to `0.0.8`.

### Fixed

- Safe Restart jobs deferred by Blood Moon protection now report a nonterminal Queued phase with the current and target game day instead of appearing stuck Running.
- Fixed partial/replayed Discord chat ingestion by preventing player identity reconciliation failures from rejecting otherwise valid log chunks.
- Prevented busy Discord chat relays from silently dropping messages at the generic alert-rule rate limit; each persisted chat event now receives normal webhook delivery and retry handling.
- Prevented a Blood Moon-deferred Safe Restart from blocking chat replies and player polling by moving interactive RCON and read-only player queries onto the agent's concurrent execution lane.
- Added durable retry records for failed Discord chat webhooks and log-timestamp deduplication so transient delivery failures no longer lose messages and agent replays do not repost them.
- Normalized Blood Moon-deferred Safe Restart status to `queued` in the jobs API so every dashboard consumer shows the wait state consistently.

## [0.0.7] - 2026-08-11

### Added

- Added a persistent, optional auto-scroll/follow toggle to the Logs page so operators can follow new output or hold their reading position.
- Added a privileged emergency Kill process control with an explicit data-corruption warning and immediate SIGKILL semantics.
- Added mod activation date/time tracking and sortable name, activation date, and author columns to the Mods page.
- Added a Safe restart server control that broadcasts a six-message 60-second countdown, flushes and backs up the world, kicks and verifies all players, and performs a verified restart.
- Added a beginner-friendly day, hour, and minute schedule builder while retaining direct cron expressions as an advanced option.
- Bumped repository, control-plane, web, and health endpoint versions to `0.0.7`.

### Changed

- Improved Logs page load and refresh performance with incremental log polling, bounded rendering, and less frequent alert refreshes.
- Corrected health charts to scope samples by host, plot the complete selected time window using real timestamps, and distinguish current values from historical averages.
- Added a customizable dashboard Quick Access section for Logs, Health, Players, Mods, Saves, Jobs, Schedules, Alerts, and Region Healer, with per-browser saved preferences.
- Added role-protected rename and unregister controls for registered hosts and server instances, with destructive-action confirmations that distinguish registry removal from deleting game files.
- Improved mod inventory loading by allowing read-only active/quarantine scans alongside long serialized server actions and reducing UI job-result polling latency.
- Fixed restored mods retaining quarantine permissions that prevented the 7DTD service account from reading `ModInfo.xml`; restored trees now receive loader-safe directory and file modes.
- Added per-rule alert pipeline testing with real Discord delivery, inline success/failure results, role protection, webhook validation, retries/rate limiting, and audit logging.
- Added Player Connected and Player Disconnected Discord alert rules driven by real 7DTD log state transitions, including server, player name, Steam ID, and EOS ID details with duplicate-event suppression.
- Added a dedicated player-only Chat section that parses genuine 7DTD chat lines, stores clean history, filters server messages, and optionally relays each server’s chat to a validated Discord webhook with mention suppression.
- Added a Chat reply box that safely sends operator messages through the audited RCON job pipeline with an automatic `say` prefix so they appear in-game as Server.

### Fixed

- Prevented duplicate Discord player lifecycle alerts by ignoring preliminary login and teleport spawn lines and deduplicating repeated connect/disconnect deliveries for 15 seconds.
- Routed scheduled 7DTD restart jobs through the full safe-restart protocol while preserving immediate manual Restart behavior.
- Fixed successful server kills appearing ineffective by waiting for job completion and using game reachability—not host-agent connectivity—for server online status.
- Made Kill idempotent so clicking it when 7DTD is already stopped verifies success instead of creating a failed job.
- Fixed restored 7DTD saves being owned exclusively by the agent, which prevented the game from rewriting ConfigsDump XML files.
- Hardened save wipes to flush the world, attempt a bounded graceful shutdown, escalate hung processes to SIGKILL, verify PID removal, and only then delete the configured save.
- Fixed save restores blocked by stale rollback directories using privileged cleanup restricted to the configured save's exact `.mastermind-restore-old` sibling.
- Ensured full-world restores return ownership to the 7DTD service account before startup, preventing restored `main.ttw` backup/write failures.
- Fixed active mod inventory and game loading failures by granting the shared server/agent group inherited read/write access to the configured Mods directory.

## [0.0.6] - 2026-08-10

### Added

- Added a Saves page for manual full-world backups, Region Healer snapshot inventory, recorded backup time/game day, server-off restore, and confirmed deletion.
- Saves now supports persistent full-backup retention and automatic intervals from 15 minutes through daily; retention never removes Region Healer snapshots.
- Added an interactive telnet command console to the Logs page with inline command responses, timeout/error feedback, and single-command input validation.
- Players page can read administrator membership and permission levels from the configured `serveradmin.xml`.
- Organization administrators can promote or demote players through constrained 7DTD console jobs; the game remains responsible for updating its XML.
- Settings includes optional Blood Moon restart protection. Restart jobs on in-game days divisible by 7 remain running until the next game day, then restart normally.
- Players and server management include Kick all with an operator-provided reason and an automatic `lp` verification requiring 0 remaining players.

### Changed

- Bumped repository, control-plane, web, and health endpoint versions to `0.0.6`.
- Scheduled jobs now receive resolved server configuration, and cron scheduling supports minute/hour step expressions.
- Hardened the agent service with narrowly scoped access to RegionHealer save snapshots.

### Fixed

- Fixed duplicate player identities across name, Steam, and EOS observations.
- Fixed rejected promote, demote, kick, ban, kick-all, and restart actions through corrected identifiers and result verification.
- Fixed save-policy retention hanging when fewer full backups exist than the configured retention count.

## [0.0.5] - 2026-08-10

### Added

- Server-first dashboard with per-server management and filtered job history.
- Persistent log tailing, retention settings, keyword alerts, and alert history.
- Host/game health monitoring with CPU, memory, disk, latency, reachability, and configurable intervals.
- Authoritative 7DTD player polling with Steam/EOS identity, session/lifetime playtime, last-seen, kick, and ban controls.
- Mod inventory with metadata parsing, multi-select, quarantine, restore, and constrained permanent deletion.
- RegionHealer service controls, account password changes, job actor attribution, responsive/mobile layouts, and branded artwork.
- Confirmed, path-constrained world-save wipe and fresh-save verification.

### Changed

- Bumped repository, control-plane, web, and health endpoint versions to `0.0.5`.
- Hardened agent deployment and service permissions around 7DTD, Mods, Saves, and RegionHealer.
- Deployment helper now requires administrator credentials through environment variables instead of embedding defaults.

### Fixed

- Pairing authorization/token generation, successful 2xx handling, BullMQ queue names, and normal-job claiming.
- False online players and incorrect session totals by making scheduled `lp` results authoritative.
- Save-wipe I/O failures by stopping and verifying 7DTD before deletion.
- Restart jobs that reported success without restarting; agent now waits for complete shutdown, starts, and verifies active state.
- Command runner timeout context now applies to the spawned process.

## [0.0.4] - 2026-04-08

### Added

- Windows bootstrap + start flow via `scripts/setup.ps1` and `scripts/start.ps1`, matching the Linux one-command setup.
- Agent-side 7DTD autodiscovery for same-host installs using local `serverconfig.xml` / `sdtdserver.xml`, `Mods/`, and `serveradmin.xml`.
- Agent-authenticated server discovery sync endpoint so paired hosts can auto-create or update their own 7DTD server instance records.
- Frigate webhook ingestion plus org-level Frigate settings and connection test support.
- Scheduler/fire-and-forget jobs now annotate `scheduleId` through queue data to the agent executor.

### Changed

- Bumped repo, control-plane, and web package versions to `0.0.4`.
- README, quickstart, install guide, and agent docs now document autodiscovery-based onboarding and current startup flows.
- Agent now dispatches jobs through registered game adapters instead of the placeholder runner path.
- Alerts, schedules, and settings dashboards now use live backend routes and current enum values.

### Fixed

- Agent/control-plane JSON field mismatches in pairing, heartbeat, job polling, and job result submission.
- Job polling now reads the actual `{ job: ... }` response envelope from the control plane.
- Control plane now normalizes UI job aliases like `start`, `stop`, `restart`, and `rcon` to backend job types.
- Job payloads now include resolved server instance config so 7DTD adapter executions have install path and telnet settings.
- Host onboarding docs now align with available schedules, alerts, org settings, and same-host 7DTD autodiscovery APIs.

## [0.0.3] - 2026-03-18

### Added

- One-line startup command via `make start` / `scripts/start.sh`.
- Agent binary download endpoints: `GET /agent/download/:platform`.
- Alerts CRUD API routes under `/api/orgs/:orgId/alerts`.
- Schedules CRUD API routes under `/api/orgs/:orgId/schedules`.
- Org settings update route `PATCH /api/orgs/:orgId` (Discord webhook support).
- Host onboarding improvements: setup wizard + agent download/build panel.
- `QUICKSTART.md` with expanded setup/API reference.

### Changed

- README updated for release `0.0.3` and new one-line quickstart.
- Bootstrap flow now builds agent binaries into `control-plane/public/agents`.
- Control-plane startup now auto-selects an available port if the preferred port is occupied.

### Fixed

- Host onboarding docs now align with available schedules/alerts/org settings APIs.

## [0.0.1] - 2026-03-11

### Added

- Initial usable control-plane + web + agent workflow.
- Auth endpoints and login/register UI.
- Org, host, server-instance, and job API modules.
- Agent pairing + heartbeat + job poll/result loop.
- Dashboard/Hosts/Jobs pages for daily operations.

### Changed

- README now documents current implemented features and install/first-run guide.

### Fixed

- (none)
## 0.0.13 — 2026-08-24

- Added verified player-facing Mod Request uploads at `/player`.
- Added short request descriptions and backend attribution to the authenticated in-game/Steam player.
- Added pending approval staging, normalized ZIP extraction, staff approve/reject workflow, and agent-side recommendation metadata.
- Rebuilt and deployed the control plane, web portal, and host agent without restarting the game server.
