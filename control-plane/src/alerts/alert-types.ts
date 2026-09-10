/** MVP alert types */
export const ALERT_TYPES = ['SERVER_DOWN', 'SERVER_RESTART', 'AGENT_OFFLINE', 'PLAYER_CONNECTED', 'PLAYER_DISCONNECTED', 'LOG_KEYWORD'] as const;
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
  playerName?: string;
  /** Minecraft UUID when known (from logs or uuid: identityKey). */
  minecraftUuid?: string;
  steamId?: string;
  /** Completed play session length, primarily for disconnect alerts. */
  sessionSeconds?: number;
  /** Arbitrary extras */
  [key: string]: unknown;
}
