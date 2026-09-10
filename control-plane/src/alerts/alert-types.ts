/** MVP alert types */
export const ALERT_TYPES = ['SERVER_DOWN', 'SERVER_RESTART', 'AGENT_OFFLINE', 'FRIGATE_DETECTION', 'PLAYER_CONNECTED', 'PLAYER_DISCONNECTED', 'LOG_KEYWORD'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Context passed when sending an alert (used for structured formatting) */
export interface AlertContext {
  orgId: string;
  orgName?: string;
  /** For SERVER_DOWN / SERVER_RESTART */
  serverInstanceId?: string;
  serverInstanceName?: string;
  hostId?: string;
  hostName?: string;
  /** For AGENT_OFFLINE */
  lastHeartbeatAt?: string;
  reason?: string;
  /** For FRIGATE_DETECTION */
  frigateCamera?: string;
  frigateLabel?: string;
  frigateScore?: number;
  playerName?: string;
  steamId?: string;
  eosId?: string;
  /** Completed play session length, primarily for disconnect alerts. */
  sessionSeconds?: number;
  /** Arbitrary extras */
  [key: string]: unknown;
}
