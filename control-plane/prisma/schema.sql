-- Mastermind Control Plane — PostgreSQL schema (MVP)
-- Multi-tenant (org), server-scoped permissions, audit-ready, job history.
-- Run in migration order; indexes included.

-- 1. orgs
CREATE TABLE orgs (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  discord_webhook_url   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. users
CREATE TABLE users (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. roles
CREATE TABLE roles (
  id   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL UNIQUE
);

-- 4. game_types
CREATE TABLE game_types (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  config_schema JSONB,
  capabilities  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. user_orgs
CREATE TABLE user_orgs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);
CREATE INDEX idx_user_orgs_org_id ON user_orgs(org_id);

-- 6. hosts (first-class; server belongs to host; status for health/offline)
CREATE TABLE hosts (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  last_heartbeat_at TIMESTAMPTZ,
  agent_version     TEXT,
  agent_key_version INT NOT NULL DEFAULT 1,
  status            TEXT DEFAULT 'unknown',
  last_metrics      JSONB,
  labels            JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hosts_org_id ON hosts(org_id);
CREATE INDEX idx_hosts_org_status ON hosts(org_id, status);

-- 7. server_instances
CREATE TABLE server_instances (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  host_id         TEXT NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
  game_type_id    TEXT NOT NULL REFERENCES game_types(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  install_path    TEXT,
  start_command   TEXT,
  rcon_host     TEXT,
  rcon_port     INT,
  rcon_password TEXT,
  config          JSONB,
  port            INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_server_instances_org_id ON server_instances(org_id);
CREATE INDEX idx_server_instances_host_id ON server_instances(host_id);

-- 8. user_server_roles
CREATE TABLE user_server_roles (
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_instance_id TEXT NOT NULL REFERENCES server_instances(id) ON DELETE CASCADE,
  role_id           TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, server_instance_id)
);
CREATE INDEX idx_user_server_roles_server_instance_id ON user_server_roles(server_instance_id);

-- 9. job_batches (bulk operations: restart wave, update wave, bulk mod install)
CREATE TABLE job_batches (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id           TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running',
  total_count      INT NOT NULL,
  pending_count    INT NOT NULL DEFAULT 0,
  running_count    INT NOT NULL DEFAULT 0,
  success_count    INT NOT NULL DEFAULT 0,
  failed_count     INT NOT NULL DEFAULT 0,
  cancelled_count  INT NOT NULL DEFAULT 0,
  created_by_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX idx_job_batches_org_id ON job_batches(org_id);
CREATE INDEX idx_job_batches_org_created ON job_batches(org_id, created_at DESC);
CREATE INDEX idx_job_batches_status ON job_batches(status);

-- 10. jobs
CREATE TABLE jobs (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  batch_id          TEXT REFERENCES job_batches(id) ON DELETE SET NULL,
  server_instance_id TEXT REFERENCES server_instances(id) ON DELETE SET NULL,
  type              TEXT NOT NULL,
  payload           JSONB,
  created_by_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_org_id ON jobs(org_id);
CREATE INDEX idx_jobs_batch_id ON jobs(batch_id);
CREATE INDEX idx_jobs_server_instance_id ON jobs(server_instance_id);
CREATE INDEX idx_jobs_org_created ON jobs(org_id, created_at DESC);

-- 11. job_runs
CREATE TABLE job_runs (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
  status     TEXT NOT NULL,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  result     JSONB,
  log_ref    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_runs_job_id ON job_runs(job_id);
CREATE INDEX idx_job_runs_job_created ON job_runs(job_id, created_at DESC);
CREATE INDEX idx_job_runs_host_id ON job_runs(host_id);

-- 12. events
CREATE TABLE events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_org_created ON events(org_id, created_at DESC);

-- 12. alert_rules
CREATE TABLE alert_rules (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id    TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  condition JSONB NOT NULL,
  channel   JSONB NOT NULL,
  enabled   BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_rules_org_id ON alert_rules(org_id);

-- 13. org_bans (central ban list per org)
CREATE TABLE org_bans (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  identifier_type   TEXT NOT NULL,
  identifier_value  TEXT NOT NULL,
  reason            TEXT,
  banned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  created_by_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_org_bans_org_identifier ON org_bans(org_id, identifier_type, identifier_value);
CREATE INDEX idx_org_bans_org_id ON org_bans(org_id);

-- 14. ban_entries (per-server; when org_ban_id set = sync record for that ban on that server)
CREATE TABLE ban_entries (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  org_ban_id          TEXT REFERENCES org_bans(id) ON DELETE CASCADE,
  server_instance_id  TEXT NOT NULL REFERENCES server_instances(id) ON DELETE CASCADE,
  identifier_type     TEXT NOT NULL,
  identifier_value    TEXT NOT NULL,
  reason              TEXT,
  banned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,
  created_by_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  sync_status         TEXT,
  synced_at           TIMESTAMPTZ,
  last_sync_error     TEXT,
  last_sync_job_id    TEXT
);
CREATE INDEX idx_ban_entries_org_id ON ban_entries(org_id);
CREATE INDEX idx_ban_entries_server_instance_id ON ban_entries(server_instance_id);
CREATE INDEX idx_ban_entries_org_identifier ON ban_entries(org_id, identifier_type, identifier_value);
CREATE INDEX idx_ban_entries_org_ban_id ON ban_entries(org_ban_id);
CREATE INDEX idx_ban_entries_server_sync ON ban_entries(server_instance_id, sync_status);

-- 15. audit_logs
CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  details       JSONB,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC);

-- 16. command_macros (saved parameterized commands, org + optional server scope)
CREATE TABLE command_macros (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  job_type            TEXT NOT NULL,
  payload_template    JSONB NOT NULL,
  param_definitions   JSONB NOT NULL,
  server_instance_id  TEXT REFERENCES server_instances(id) ON DELETE SET NULL,
  allowed_role_names  JSONB NOT NULL,
  created_by_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_command_macros_org_id ON command_macros(org_id);
CREATE INDEX idx_command_macros_server_instance_id ON command_macros(server_instance_id);

-- 17. schedules (cron, execution window, retry policy, telemetry)
CREATE TABLE schedules (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id                  TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  server_instance_id      TEXT NOT NULL REFERENCES server_instances(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT,
  cron_expression         TEXT NOT NULL,
  job_type                TEXT NOT NULL,
  payload                 JSONB,
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  execution_window_start  TEXT,
  execution_window_end    TEXT,
  retry_policy            JSONB,
  last_run_at             TIMESTAMPTZ,
  next_run_at             TIMESTAMPTZ,
  last_run_status         TEXT,
  last_run_job_id         TEXT,
  run_count               INT NOT NULL DEFAULT 0,
  failure_count           INT NOT NULL DEFAULT 0,
  created_by_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_schedules_org_id ON schedules(org_id);
CREATE INDEX idx_schedules_server_instance_id ON schedules(server_instance_id);
CREATE INDEX idx_schedules_enabled_next_run ON schedules(enabled, next_run_at);

-- 18. mod_artifacts
CREATE TABLE mod_artifacts (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  game_type_id TEXT REFERENCES game_types(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  version      TEXT,
  file_ref     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mod_artifacts_org_id ON mod_artifacts(org_id);
CREATE INDEX idx_mod_artifacts_game_type_id ON mod_artifacts(game_type_id);

-- 19. pairing_tokens (single-use, expiry; org-scoped)
CREATE TABLE pairing_tokens (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_by_id   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_by_host_id TEXT UNIQUE REFERENCES hosts(id) ON DELETE SET NULL
);
CREATE INDEX idx_pairing_tokens_org_id ON pairing_tokens(org_id);
CREATE INDEX idx_pairing_tokens_token_hash ON pairing_tokens(token_hash);
CREATE INDEX idx_pairing_tokens_expires_at ON pairing_tokens(expires_at);
