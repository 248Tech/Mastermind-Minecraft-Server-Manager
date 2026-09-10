/** Job types for Minecraft server control */
export const JOB_TYPES = [
  'SERVER_START',
  'SERVER_STOP',
  'SERVER_KILL',
  'SERVER_RESTART',
  'SERVER_SAFE_RESTART',
  'SERVER_SAVEWORLD',
  'SERVER_SAVE_STOP',
  'SERVER_MAINTENANCE',
  'SERVER_WIPE_SAVE',
  'SERVER_UPDATE',
  'RCON',
  'SEND_COMMAND',
  'SAVE_LIST',
  'SAVE_BACKUP',
  'SAVE_RESTORE',
  'SAVE_DELETE',
  'SAVE_RETENTION',
  'PLAYER_KICK',
  'PLAYER_KICK_ALL',
  'PLAYER_BAN',
  'PLAYER_SET_DEATHS',
  'PLAYER_LIST_SYNC',
  'PLAYER_ADMIN_LIST',
  'PLAYER_ADMIN_PROMOTE',
  'PLAYER_ADMIN_DEMOTE',
  'MOD_LIST',
  'MOD_QUARANTINE',
  'MOD_QUARANTINE_LIST',
  'MOD_RESTORE',
  'MOD_DELETE',
  'MOD_CONFIG_READ',
  'MOD_CONFIG_WRITE',
  'MOD_CONFIG_MERGE_PREVIEW',
  'MOD_CONFIG_MERGE_APPLY',
  'SERVER_CONFIG_READ',
  'SERVER_CONFIG_WRITE',
  'MOD_UPLOAD_QUARANTINE',
  'MOD_UPLOAD_PENDING',
  'MOD_PENDING_LIST',
  'MOD_PENDING_APPROVE',
  'MOD_PENDING_REJECT',
  'ITEM_CATALOG',
  'TRIGGER_GRANT_ITEMS',
  'start',
  'stop',
  'restart',
  'rcon',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_RUN_STATUS = ['pending', 'running', 'success', 'failed', 'cancelled'] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUS)[number];

export const MAX_RETRIES = 2;
export const JOB_ATTEMPTS = MAX_RETRIES + 1;

export const QUEUE_PREFIX = 'jobs';
