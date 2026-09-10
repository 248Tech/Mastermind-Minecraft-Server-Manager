/**
 * API response: never include rconPassword in list; include masked or only in get-one for editing (optional).
 * Here we expose it only for get-one so admins can edit; list omits it.
 */
export class ServerInstanceResponseDto {
  id: string;
  orgId: string;
  hostId: string;
  gameTypeId: string;
  gameType?: string; // slug for convenience
  /** Supported adapter capabilities for this game type; UI renders only these actions. */
  capabilities?: string[];
  name: string;
  installPath: string | null;
  startCommand: string | null;
  rconHost: string | null;
  rconPort: number | null;
  /** Omitted in list; present in get-one when needed for editing. */
  rconPassword?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
