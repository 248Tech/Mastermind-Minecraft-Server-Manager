const CP = (): string => {
  const url = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL;
  if (!url) {
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
      console.warn('[mastermind] NEXT_PUBLIC_CONTROL_PLANE_URL is not set — falling back to http://localhost:3001');
    }
    return 'http://localhost:3001';
  }
  return url;
};

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('mm_token');
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

function notifyInvalidSession(status: number) {
  if (status === 401 && typeof window !== 'undefined' && getToken()) {
    window.dispatchEvent(new Event('mastermind-auth-invalid'));
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${CP()}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    notifyInvalidSession(res.status);
    const rawMessage = (body as { message?: string | string[] }).message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage;
    throw new ApiError(message || `HTTP ${res.status}`, res.status);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: async <T>(path: string, body: FormData, method: 'POST' | 'PATCH' = 'POST'): Promise<T> => {
    const token = getToken();
    const res = await fetch(`${CP()}${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const message = Array.isArray((payload as { message?: unknown }).message)
        ? ((payload as { message: string[] }).message).join(', ')
        : (payload as { message?: string }).message;
      notifyInvalidSession(res.status);
      throw new ApiError(message || `HTTP ${res.status}`, res.status);
    }
    return res.json() as Promise<T>;
  },
  blob: async (path: string): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`${CP()}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      notifyInvalidSession(res.status);
      throw new ApiError(`HTTP ${res.status}`, res.status);
    }
    return res.blob();
  },
};

// Auth types
export interface AuthResponse { access_token: string; userId: string; orgId: string; }
export interface User { id: string; email: string; name?: string; }
export interface OrgAccount { id:string; email:string; name:string|null; role:'admin'|'operator'|'viewer'; createdAt:string; approvedAt:string|null; emailVerifiedAt:string|null; signInEnabled:boolean; steamLinked?:boolean; steamIdLast4?:string|null; }
export interface Org { id: string; name: string; slug: string; discordWebhookUrl?: string; stabilityRestartEnabled?:boolean; stabilityRestartMemoryGiB?:number; stabilityRestartCooldownMinutes?:number; openaiConfigured?:boolean; openaiModel?:string; modAiProvider?:'codex'|'kimi'; kimiConfigured?:boolean; kimiModel?:string; cloudflareConfigured?:boolean; digitalOceanConfigured?:boolean; mailgunConfigured?:boolean; mailgunDomain?:string; mailgunFromEmail?:string; mailgunRegion?:'us'|'eu'; stripeConfigured?:boolean; stripeWebhookConfigured?:boolean; stripeWebhookUrl?:string; maintenancePasswordConfigured?:boolean; }
export interface Host { id: string; orgId: string; name: string; status: string | null; lastHeartbeatAt: string | null; lastMetrics: Record<string,unknown> | null; agentVersion: string | null; createdAt: string; serverInstances: { id: string; name: string }[]; }
export interface ServerInstance { id: string; orgId: string; hostId: string; name: string; gameType: string; capabilities: string[]; installPath: string | null; startCommand: string | null; updateCommand?: string | null; telnetHost: string | null; telnetPort: number | null; maintenanceMode?: boolean; rebootIfDown?: boolean; mapEmbedUrl?: string | null; createdAt: string; }
export interface Job { id: string; orgId: string; serverInstanceId: string | null; serverName?: string; type: string; payload: unknown; createdAt: string; startedBy?: { id:string; name:string; email:string } | null; latestRun: { id: string; status: string; startedAt: string | null; finishedAt: string | null; result: unknown } | null; }
export interface Schedule { id: string; orgId: string; serverInstanceId: string; name: string; cronExpression: string; jobType: string; payload?: Record<string,unknown>; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; lastRunStatus: string | null; skipNextRun?: boolean; skipNextRunReason?: string | null; }
export interface AlertRule { id: string; orgId: string; name: string; condition: unknown; channel: unknown; enabled: boolean; createdAt: string; }
export interface TriggerRecord {
  id: string;
  orgId: string;
  serverInstanceId: string;
  name: string;
  enabled: boolean;
  eventType: string;
  eventConfig: { level?: number; comparison?: string };
  actionType: string;
  actionConfig: { claimCount?: number; notifyPlayer?: boolean; message?: string; items?: { name: string; quantity: number }[] };
  applyToExisting: boolean;
  lastFiredAt: string | null;
  fireCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface TriggerFireRecord {
  id: string;
  eventKey: string;
  status: string;
  jobId: string | null;
  createdAt: string;
  player: { id: string; name: string; steamId: string | null; level: number };
}
export interface PairingToken { id: string; token: string; expiresAt: string; expiresInSec: number; }
export interface ServerLog { id: string; serverInstanceId: string; content: string; createdAt: string; }
export interface LogKeywordRule { id: string; name: string; enabled: boolean; condition: { keyword: string; caseSensitive: boolean; serverInstanceId: string }; createdAt: string; }
export interface LogKeywordMatch { id: string; sourceId: string; createdAt: string; payload: { ruleId: string; ruleName: string; keyword: string; excerpt: string }; }
export interface HealthSample { id: string; hostId: string; cpuPercent: number; ramUsedMb: number; ramTotalMb: number; diskUsedGb: number; latencyMs: number; gameReachable: boolean; createdAt: string; }
export interface HealthHost { id: string; name: string; status: string; lastHeartbeatAt: string|null; lastMetrics: { cpu?:number; ramUsedMb?:number; ramTotalMb?:number; diskUsedGb?:number; latencyMs?:number; gameReachable?:boolean }|null; }
export interface HealthDashboard { hosts: HealthHost[]; samples: HealthSample[]; intervalSec: number; }
export interface ChatMessage { id:string; sourceId:string; createdAt:string; payload:{playerId:string;entityId:string;playerName:string;channel:string;message:string;serverInstanceName:string}; }
export interface PlayerRecord { id:string; serverInstanceId:string; identityKey:string; steamId:string|null; entityId:number|null; ipAddress:string|null; name:string; online:boolean; currentSessionStartedAt:string|null; sessionSeconds:number; lifetimeSeconds:number; deaths:number; level:number; lastPosX:number|null; lastPosY:number|null; lastPosZ:number|null; lastLogoutAt:string|null; firstSeenAt:string; lastSeenAt:string; }
export interface ServerAdminRecord { platform?:string; userId:string; name?:string; permissionLevel:number; }
export interface ModRecord { folder:string; name:string; author?:string; website?:string; version?:string; activatedAt:string; pendingRestart?:boolean; configFiles?:string[]; recommendedBy?:string; recommendedAt?:string; originalName?:string; description?:string; overrideActive?:boolean; transferConfig?:boolean; conflictsWithActive?:boolean; restoreTarget?:string; }
export interface MergeFileResult { path:string; mergedContent:string; templateContent?:string; stats:{carried:number;newKeys:number;dropped:number}; parseFormat:string; warning?:string; skipped?:boolean; }
export interface SaveRecord { id:string; createdAt:string; gameDay:number; kind:'full-world'|'region-healer'; sizeBytes:number; }
export interface ShopItem { id:string; name:string; description:string; priceCents:number; active:boolean; hasImage:boolean; sortOrder:number; createdAt:string; grantItemName?:string|null; grantQuantity?:number; grantItems?:{name:string;quantity:number}[]; }
export interface TriggerCatalog { events:{type:string;label:string}[]; actions:{type:string;label:string}[]; }
export interface DonationLine { id:string; shopItemId:string|null; itemName:string; amountCents:number; quantity:number; grantStatus?:string; grantError?:string|null; grantItems?:{name:string;quantity:number;status?:string}[]; }
export interface DonationRecord { id:string; playerName:string; steamId:string; amountCents:number; refundedCents:number; status:string; completedAt:string|null; createdAt:string; lines:DonationLine[]; }
