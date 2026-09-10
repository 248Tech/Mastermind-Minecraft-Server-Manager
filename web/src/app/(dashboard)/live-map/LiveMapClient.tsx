"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  LayerGroup,
  Rectangle,
  Tooltip,
  Polyline,
  Polygon,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { api, PlayerRecord, ServerInstance } from "../../../lib/api";
import { getStoredOrgId } from "../../../lib/auth";
import { getStoredServerId, useServerSelection } from "../../../lib/server-selection";
type Entity = {
  id: string | number;
  name: string;
  steamId?: string;
  position: { x: number; y: number; z: number };
};
type Config = {
  enabled: boolean;
  mapBlockSize?: number;
  maxZoom?: number;
  mapSize: { x: number; y: number; z: number };
};
type Snapshot = {
  at: number;
  players: Entity[];
  animals: Entity[];
  hostiles: Entity[];
};
type Claim = {
  id: string;
  owner: string;
  eosId: string;
  steamId: string;
  position: { x: number; y: number; z: number };
  size: number;
};
type PrismaMarker = {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  extra?: string;
};
type PrismaHome = {
  id: string;
  owner: string;
  steamId: string;
  position: { x: number; y: number; z: number };
  active: boolean;
};
type PrismaPoi = {
  id: string;
  name: string;
  x: number;
  z: number;
  minx: number;
  maxx: number;
  minz: number;
  maxz: number;
  containsBed: boolean;
};
type PrismaRect = {
  id: string;
  name: string;
  type: string;
  e: number;
  w: number;
  n: number;
  s: number;
};
type Region = { name: string; x: number; z: number };
type WorldInfo = {
  width: number;
  height: number;
  gameVersion?: string;
  seed?: string;
  source: string;
};
type VisitMapStatus = {
  state: "idle" | "running" | "stalled" | "stopped" | "complete";
  percent?: number;
  done?: number;
  total?: number;
  estimatedSeconds?: number | null;
  at?: string;
};
const HISTORY_KEY = "mm_live_map_history_v2",
  HISTORY_RETENTION_MS = 72 * 60 * 60 * 1000,
  MAX_HISTORY = 25_920,
  MAX_TRAIL_POINTS = 2_000;

function snapshotAtOrBefore(snapshots: Snapshot[], at: number): Snapshot | null {
  let chosen: Snapshot | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.at > at) continue;
    if (!chosen || snapshot.at >= chosen.at) chosen = snapshot;
  }
  return chosen;
}

function compactSnapshots(snapshots: Snapshot[]): Snapshot[] {
  const recentCutoff = Date.now() - 30 * 60_000;
  const recent: Snapshot[] = [];
  const kept: Snapshot[] = [];
  let lastBucket = -1;
  for (const snapshot of snapshots) {
    if (snapshot.at >= recentCutoff) {
      recent.push(snapshot);
      continue;
    }
    const bucket = Math.floor(snapshot.at / 60_000);
    if (bucket !== lastBucket) {
      kept.push(snapshot);
      lastBucket = bucket;
    }
  }
  return [...kept, ...recent].slice(-MAX_HISTORY);
}

function serializeHistory(snapshots: Snapshot[]) {
  return JSON.stringify(
    snapshots.map((snapshot) => ({
      at: snapshot.at,
      players: snapshot.players.map((player: Entity) => ({
        id: player.id,
        name: player.name,
        steamId: player.steamId,
        position: {
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
        },
      })),
      animals: [],
      hostiles: [],
    })),
  );
}

function persistPlayerHistory(snapshots: Snapshot[]) {
  try {
    localStorage.setItem(HISTORY_KEY, serializeHistory(snapshots));
  } catch {
    try {
      localStorage.setItem(HISTORY_KEY, serializeHistory(compactSnapshots(snapshots)));
    } catch {
      /* Storage full: in-memory history still works for this session. */
    }
  }
}

function sampleTrail(points: [number, number][]) {
  if (points.length <= MAX_TRAIL_POINTS) return points;
  const last = points.length - 1;
  return Array.from({ length: MAX_TRAIL_POINTS }, (_, index) =>
    points[Math.round((index * last) / (MAX_TRAIL_POINTS - 1))],
  );
}
function playerTrackKey(player: Pick<Entity, "id" | "name" | "steamId">) {
  const candidates = [player.steamId, player.id].map((value) =>
    String(value ?? "").replace(/^Steam_/i, "").trim(),
  );
  const steam = candidates.find((value) => /^[0-9]{15,20}$/.test(value));
  if (steam) return `steam:${steam}`;
  const name = String(player.name || "").trim().toLocaleLowerCase();
  if (name) return `name:${name}`;
  return `id:${String(player.id ?? "").trim()}`;
}
function playerIdentityScore(player: Pick<Entity, "id" | "name" | "steamId">) {
  let score = 0;
  if (player.steamId && /^[0-9]{15,20}$/.test(String(player.steamId).replace(/^Steam_/i, ""))) score += 4;
  const id = String(player.id ?? "").replace(/^Steam_/i, "").trim();
  if (/^[0-9]{15,20}$/.test(id)) score += 2;
  if (String(player.name || "").trim()) score += 1;
  return score;
}
function dedupePlayerChoices(entities: Entity[]) {
  const merged = new Map<string, Entity>();
  for (const player of entities) {
    const nameKey = String(player.name || "").trim().toLocaleLowerCase();
    const key = nameKey || playerTrackKey(player);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, player);
      continue;
    }
    const preferred = playerIdentityScore(player) >= playerIdentityScore(existing) ? player : existing;
    const fallback = preferred === player ? existing : player;
    merged.set(key, {
      ...preferred,
      name: preferred.name || fallback.name,
      steamId: preferred.steamId || fallback.steamId,
      id: preferred.id ?? fallback.id,
      position: preferred.position ?? fallback.position,
    });
  }
  return [...merged.values()];
}
function poiBounds(poi: PrismaPoi): [[number, number], [number, number]] {
  const halfX = Math.floor(Math.abs(poi.minx - poi.maxx) / 2);
  const halfZ = Math.floor(Math.abs(poi.minz - poi.maxz) / 2);
  return [
    [poi.x - halfX, poi.z - halfZ],
    [poi.x + halfX, poi.z + halfZ],
  ];
}
function rectPolygon(rect: PrismaRect): [number, number][] {
  return [
    [rect.e, rect.s],
    [rect.w, rect.s],
    [rect.w, rect.n],
    [rect.e, rect.n],
  ];
}
const dot = (color: string) =>
  L.divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px #000"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
function Coordinates() {
  const [text, setText] = useState("Move or click for coordinates");
  useMapEvents({
    mousemove: (e) =>
      setText(`${Math.floor(e.latlng.lat)} E / ${Math.floor(e.latlng.lng)} N`),
    click: (e) =>
      setText(
        `Pinned: ${Math.floor(e.latlng.lat)} E / ${Math.floor(e.latlng.lng)} N`,
      ),
  });
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 1000,
        left: 10,
        bottom: 66,
        background: "rgba(15,23,42,.9)",
        color: "#e2e8f0",
        padding: "6px 9px",
        borderRadius: 5,
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}
function FollowTracked({
  active,
  position,
  recenterKey,
}: {
  active: boolean;
  position: [number, number] | null;
  recenterKey: string;
}) {
  const map = useMap();
  const lastKey = useRef("");
  useEffect(() => {
    if (!active || !position) {
      lastKey.current = "";
      return;
    }
    const target = L.latLng(position[0], position[1]);
    if (lastKey.current !== recenterKey) {
      lastKey.current = recenterKey;
      map.setView(target, Math.max(map.getZoom(), 2), { animate: true });
      return;
    }
    if (!map.getBounds().pad(-0.25).contains(target)) {
      map.panTo(target, { animate: true, duration: 0.4 });
    }
  }, [active, position, map, recenterKey]);
  return null;
}
function trackedDot(color: string) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:20px;height:20px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 4px ${color}66,0 1px 8px #000"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}
function MapViewportControls({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  return (
    <div className="map-viewport-controls">
      <button type="button" onClick={() => map.fitBounds(bounds, { padding: [18, 18] })}>Fit world</button>
      <button type="button" onClick={() => map.setZoom(Math.max(map.getMinZoom(), 0))}>Reset zoom</button>
    </div>
  );
}
function MapLegend({ prismaConfigured, showLogoutLocations, showClaims }: { prismaConfigured: boolean; showLogoutLocations: boolean; showClaims: boolean }) {
  const items = [
    ["#3b82f6", "Players"],
    ...(showLogoutLocations ? [["#f59e0b", "Logout"]] : []),
    ...(showClaims ? [["#a855f7", "Land claims"]] : []),
    ["#22c55e", "Animals"],
    ["#ef4444", "Hostiles"],
    ...(prismaConfigured ? [["#eab308", "POIs"], ["#38bdf8", "Vehicles"]] : []),
  ];
  return (
    <div className="map-legend" aria-label="Map legend">
      <strong>Legend</strong>
      {items.map(([color, label]) => (
        <span key={label}><i style={{ background: color }} />{label}</span>
      ))}
    </div>
  );
}
function formatAge(at: number | null) {
  if (!at) return "Waiting for first update";
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return seconds < 5 ? "Updated just now" : `Updated ${seconds}s ago`;
}
function MapFilterCheckbox({
  checked,
  disabled,
  onChange,
  color,
  title,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  color: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <label
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: disabled ? "#64748b" : color,
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.72 : 1,
      }}
    >
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: color }}
      />
      {children}
    </label>
  );
}
function resetMapFilters(setters: {
  setTrackedPlayer: (value: string) => void;
  setShowAllPlayerTrails: (value: boolean) => void;
  setShowTrailsLayer: (value: boolean) => void;
  setShowPlayersLayer: (value: boolean) => void;
  setShowAnimalsLayer: (value: boolean) => void;
  setShowHostilesLayer: (value: boolean) => void;
  setShowRegionGrid: (value: boolean) => void;
  setShowPlayerNames: (value: boolean) => void;
  setShowLogoutLocations: (value: boolean) => void;
  setShowClaims: (value: boolean) => void;
  setShowVehicles: (value: boolean) => void;
  setShowDrones: (value: boolean) => void;
  setShowBeds: (value: boolean) => void;
  setShowTraders: (value: boolean) => void;
  setShowQuestPois: (value: boolean) => void;
  setShowResetRegions: (value: boolean) => void;
  setShowAdvClaims: (value: boolean) => void;
  setShowAllPois: (value: boolean) => void;
  setEntitySearch: (value: string) => void;
  setAdvClaimFilter: (value: string) => void;
  setHistoryCursorAt: (value: number | null) => void;
}) {
  setters.setTrackedPlayer("");
  setters.setShowAllPlayerTrails(false);
  setters.setShowTrailsLayer(true);
  setters.setShowPlayersLayer(true);
  setters.setShowAnimalsLayer(false);
  setters.setShowHostilesLayer(true);
  setters.setShowRegionGrid(false);
  setters.setShowPlayerNames(true);
  setters.setShowLogoutLocations(true);
  setters.setShowClaims(true);
  setters.setShowVehicles(false);
  setters.setShowDrones(false);
  setters.setShowBeds(false);
  setters.setShowTraders(false);
  setters.setShowQuestPois(false);
  setters.setShowResetRegions(false);
  setters.setShowAdvClaims(false);
  setters.setShowAllPois(false);
  setters.setEntitySearch("");
  setters.setAdvClaimFilter("all");
  setters.setHistoryCursorAt(null);
}

type MapFilterPanelProps = {
  prismaConfigured: boolean;
  viewed: { players: Entity[]; animals: Entity[]; hostiles: Entity[] };
  claims: Claim[];
  logoutMarkers: Array<{ id: string }>;
  vehicles: PrismaMarker[];
  drones: PrismaMarker[];
  homes: PrismaHome[];
  traders: PrismaMarker[];
  questPois: PrismaPoi[];
  allPois: PrismaPoi[];
  resetRegions: PrismaRect[];
  advClaims: PrismaRect[];
  showTrailsLayer: boolean;
  setShowTrailsLayer: (value: boolean) => void;
  showPlayersLayer: boolean;
  setShowPlayersLayer: (value: boolean) => void;
  showAnimalsLayer: boolean;
  setShowAnimalsLayer: (value: boolean) => void;
  showHostilesLayer: boolean;
  setShowHostilesLayer: (value: boolean) => void;
  showAllPlayerTrails: boolean;
  setShowAllPlayerTrails: (value: boolean) => void;
  showPlayerNames: boolean;
  setShowPlayerNames: (value: boolean) => void;
  showLogoutLocations: boolean;
  setShowLogoutLocations: (value: boolean) => void;
  showClaims: boolean;
  setShowClaims: (value: boolean) => void;
  showVehicles: boolean;
  setShowVehicles: (value: boolean) => void;
  showDrones: boolean;
  setShowDrones: (value: boolean) => void;
  showBeds: boolean;
  setShowBeds: (value: boolean) => void;
  showTraders: boolean;
  setShowTraders: (value: boolean) => void;
  showQuestPois: boolean;
  setShowQuestPois: (value: boolean) => void;
  showAllPois: boolean;
  setShowAllPois: (value: boolean) => void;
  showResetRegions: boolean;
  setShowResetRegions: (value: boolean) => void;
  showAdvClaims: boolean;
  setShowAdvClaims: (value: boolean) => void;
  showRegionGrid: boolean;
  setShowRegionGrid: (value: boolean) => void;
  advClaimFilter: string;
  setAdvClaimFilter: (value: string) => void;
  onReset?: () => void;
};

function MapFilterPanel({
  prismaConfigured,
  viewed,
  claims,
  logoutMarkers,
  vehicles,
  drones,
  homes,
  traders,
  questPois,
  allPois,
  resetRegions,
  advClaims,
  showTrailsLayer,
  setShowTrailsLayer,
  showPlayersLayer,
  setShowPlayersLayer,
  showAnimalsLayer,
  setShowAnimalsLayer,
  showHostilesLayer,
  setShowHostilesLayer,
  showAllPlayerTrails,
  setShowAllPlayerTrails,
  showPlayerNames,
  setShowPlayerNames,
  showLogoutLocations,
  setShowLogoutLocations,
  showClaims,
  setShowClaims,
  showVehicles,
  setShowVehicles,
  showDrones,
  setShowDrones,
  showBeds,
  setShowBeds,
  showTraders,
  setShowTraders,
  showQuestPois,
  setShowQuestPois,
  showAllPois,
  setShowAllPois,
  showResetRegions,
  setShowResetRegions,
  showAdvClaims,
  setShowAdvClaims,
  showRegionGrid,
  setShowRegionGrid,
  advClaimFilter,
  setAdvClaimFilter,
  onReset,
}: MapFilterPanelProps) {
  return (
    <>
      <div className="map-filter-section">
        <strong>Live entities</strong>
        <div className="map-filter-grid">
          <MapFilterCheckbox checked={showTrailsLayer} onChange={setShowTrailsLayer} color="#60a5fa">Player trails</MapFilterCheckbox>
          <MapFilterCheckbox checked={showPlayersLayer} onChange={setShowPlayersLayer} color="#60a5fa">Players ({viewed.players.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showAnimalsLayer} onChange={setShowAnimalsLayer} color="#22c55e">Animals ({viewed.animals.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showHostilesLayer} onChange={setShowHostilesLayer} color="#ef4444">Hostiles ({viewed.hostiles.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showAllPlayerTrails} onChange={setShowAllPlayerTrails} color="#60a5fa">All player trails</MapFilterCheckbox>
          <MapFilterCheckbox checked={showPlayerNames} onChange={setShowPlayerNames} color="#60a5fa">Player names</MapFilterCheckbox>
        </div>
      </div>
      <div className="map-filter-section">
        <strong>World overlays</strong>
        <div className="map-filter-grid">
          <MapFilterCheckbox checked={showLogoutLocations} onChange={setShowLogoutLocations} color="#fbbf24">Logout locations ({logoutMarkers.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showClaims} onChange={setShowClaims} color="#c084fc">Land claims ({claims.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showVehicles} disabled={!prismaConfigured} onChange={setShowVehicles} color="#38bdf8" title={prismaConfigured ? undefined : "PrismaCore not configured"}>Vehicles ({vehicles.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showDrones} disabled={!prismaConfigured} onChange={setShowDrones} color="#f472b6" title={prismaConfigured ? undefined : "PrismaCore not configured"}>Drones ({drones.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showBeds} disabled={!prismaConfigured} onChange={setShowBeds} color="#4ade80" title={prismaConfigured ? undefined : "PrismaCore not configured"}>Beds ({homes.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showTraders} disabled={!prismaConfigured} onChange={setShowTraders} color="#facc15" title={prismaConfigured ? undefined : "PrismaCore not configured"}>Traders ({traders.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showQuestPois} disabled={!prismaConfigured} onChange={setShowQuestPois} color="#f87171" title={prismaConfigured ? undefined : "PrismaCore not configured"}>Quest POIs ({questPois.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showAllPois} disabled={!prismaConfigured} onChange={setShowAllPois} color="#eab308" title={prismaConfigured ? undefined : "PrismaCore not configured"}>All POIs ({allPois.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showResetRegions} disabled={!prismaConfigured} onChange={setShowResetRegions} color="#fca5a5" title={prismaConfigured ? undefined : "PrismaCore not configured"}>Reset regions ({resetRegions.length})</MapFilterCheckbox>
          <MapFilterCheckbox checked={showAdvClaims} disabled={!prismaConfigured} onChange={setShowAdvClaims} color="#22d3ee" title={prismaConfigured ? undefined : "PrismaCore not configured"}>Adv. claims ({advClaims.length})</MapFilterCheckbox>
        </div>
        <select
          aria-label="Advanced claim type"
          disabled={!prismaConfigured}
          value={advClaimFilter}
          onChange={(event) => setAdvClaimFilter(event.target.value)}
          title={prismaConfigured ? undefined : "PrismaCore not configured"}
          style={{ background: "#0d0d14", color: prismaConfigured ? "#e2e8f0" : "#64748b", border: "1px solid #334155", borderRadius: 6, padding: "6px 9px", width: "100%", opacity: prismaConfigured ? 1 : 0.72 }}
        >
          <option value="all">Adv. claims (all types)</option>
          {[...new Set(advClaims.map((claim) => claim.type))].sort().map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>
      <div className="map-filter-section">
        <strong>Map</strong>
        <div className="map-filter-grid">
          <MapFilterCheckbox checked={showRegionGrid} onChange={setShowRegionGrid} color="#94a3b8">Region grid</MapFilterCheckbox>
        </div>
      </div>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          style={{ background: "#334155", color: "#e2e8f0", border: 0, borderRadius: 6, padding: "7px 10px", cursor: "pointer", marginTop: 4 }}
        >
          Reset filters
        </button>
      )}
    </>
  );
}

export default function LiveMapClient() {
  const orgId = getStoredOrgId();
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [feedError, setFeedError] = useState(""),
    [lastLiveUpdate, setLastLiveUpdate] = useState<number | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [players, setPlayers] = useState<Entity[]>([]),
    [animals, setAnimals] = useState<Entity[]>([]),
    [hostiles, setHostiles] = useState<Entity[]>([]),
    [claims, setClaims] = useState<Claim[]>([]),
    [regionFiles, setRegionFiles] = useState<Region[]>([]),
    [worldInfo, setWorldInfo] = useState<WorldInfo | null>(null),
    [gameTime, setGameTime] = useState(""),
    [history, setHistory] = useState<Snapshot[]>([]),
    [historyCursorAt, setHistoryCursorAt] = useState<number | null>(null),
    [historyWindow, setHistoryWindow] = useState(120),
    [trackedPlayer, setTrackedPlayer] = useState(""),
    [trackingColor, setTrackingColor] = useState("#ff2bd6"),
    [showAllPlayerTrails, setShowAllPlayerTrails] = useState(false),
    [showTrailsLayer, setShowTrailsLayer] = useState(true),
    [showPlayersLayer, setShowPlayersLayer] = useState(true),
    [showAnimalsLayer, setShowAnimalsLayer] = useState(false),
    [showHostilesLayer, setShowHostilesLayer] = useState(true),
    [showRegionGrid, setShowRegionGrid] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    [showClaims, setShowClaims] = useState(true),
    [showPlayerNames, setShowPlayerNames] = useState(true),
    [showLogoutLocations, setShowLogoutLocations] = useState(true),
    [showVehicles, setShowVehicles] = useState(false),
    [showDrones, setShowDrones] = useState(false),
    [showBeds, setShowBeds] = useState(false),
    [showTraders, setShowTraders] = useState(false),
    [showQuestPois, setShowQuestPois] = useState(false),
    [showResetRegions, setShowResetRegions] = useState(false),
    [showAdvClaims, setShowAdvClaims] = useState(false),
    [entitySearch, setEntitySearch] = useState(""),
    [prismaConfigured, setPrismaConfigured] = useState(false),
    [vehicles, setVehicles] = useState<PrismaMarker[]>([]),
    [drones, setDrones] = useState<PrismaMarker[]>([]),
    [traders, setTraders] = useState<PrismaMarker[]>([]),
    [homes, setHomes] = useState<PrismaHome[]>([]),
    [questPois, setQuestPois] = useState<PrismaPoi[]>([]),
    [allPois, setAllPois] = useState<PrismaPoi[]>([]),
    [resetRegions, setResetRegions] = useState<PrismaRect[]>([]),
    [advClaims, setAdvClaims] = useState<PrismaRect[]>([]),
    [showAllPois, setShowAllPois] = useState(false),
    [advClaimFilter, setAdvClaimFilter] = useState("all"),
    [logoutMarkers, setLogoutMarkers] = useState<Array<{ id: string; name: string; x: number; y: number | null; z: number; lastLogoutAt: string | null }>>([]),
    [servers, setServers] = useState<ServerInstance[]>([]),
    [server, setServer] = useState<ServerInstance | null>(null),
    [visitBusy, setVisitBusy] = useState(false),
    [visitNotice, setVisitNotice] = useState(""),
    [visitStatus, setVisitStatus] = useState<VisitMapStatus>({ state: "idle" }),
    [visitSection, setVisitSection] = useState(0);
  const selectServer = useServerSelection(servers, server?.id || "", (serverId) => setServer(servers.find((candidate) => candidate.id === serverId) ?? null));
  const prismaConfiguredRef = useRef(false);
  const prismaClaimsActiveRef = useRef(false);
  const filtersPanelRef = useRef<HTMLDivElement>(null);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const [overlayPanelStyle, setOverlayPanelStyle] = useState<CSSProperties>({});
  useEffect(() => {
    if (!filtersOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!filtersPanelRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    }
    function positionOverlayPanel() {
      const toggle = filterToggleRef.current;
      if (!toggle) return;
      const rect = toggle.getBoundingClientRect();
      const width = Math.min(380, window.innerWidth - 24);
      const right = Math.max(12, window.innerWidth - rect.right);
      const spaceBelow = window.innerHeight - rect.bottom - 16;
      const spaceAbove = rect.top - 16;
      const maxHeight = Math.min(640, Math.max(spaceBelow, spaceAbove) - 8);
      if (spaceBelow >= 240 || spaceBelow >= spaceAbove) {
        setOverlayPanelStyle({ top: rect.bottom + 6, right, width, maxHeight });
      } else {
        setOverlayPanelStyle({ bottom: window.innerHeight - rect.top + 6, right, width, maxHeight });
      }
    }
    positionOverlayPanel();
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", positionOverlayPanel);
    window.addEventListener("scroll", positionOverlayPanel, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", positionOverlayPanel);
      window.removeEventListener("scroll", positionOverlayPanel, true);
    };
  }, [filtersOpen]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY) || localStorage.getItem("mm_live_map_history_v1") || "[]";
      const saved = JSON.parse(raw);
      if (Array.isArray(saved))
        setHistory(
          saved
            .filter((x: { at?: number }) => Number(x?.at) > Date.now() - HISTORY_RETENTION_MS)
            .map((snapshot: { at: number; players?: Entity[] }) => ({
              at: snapshot.at,
              players: Array.isArray(snapshot.players) ? snapshot.players : [],
              animals: [],
              hostiles: [],
            }))
            .slice(-MAX_HISTORY),
        );
    } catch {
      /* Ignore damaged browser history. */
    }
  }, []);
  useEffect(() => {
    const token = localStorage.getItem("mm_token");
    if (!token) {
      setError("Sign in again to open the map.");
      return;
    }
    fetch("/api/live-map-session", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Could not authorize Live Map");
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const get = async (path: string) => {
      const separator = path.includes("?") ? "&" : "?";
      const r = await fetch(`/api/live-map/${path}${separator}serverInstanceId=${encodeURIComponent(server?.id || "")}`, { cache: "no-store" });
      const body = await r.json();
      if (!r.ok)
        throw new Error(body.message || `Map API returned ${r.status}`);
      return body.data ?? body;
    };
    const loadConfig = () =>
      get("api/map/config")
        .then((v) => active && setConfig(v))
        .catch((e) => active && setError(e.message));
    const loadWorldInfo = () =>
      get("world-info")
        .then((value) => active && setWorldInfo(value))
        .catch(() => undefined);
    const update = () => {
      void get("entities-live")
        .then((e) => {
          if (!active) return;
          const next = {
            at: Date.now(),
            players: e.players ?? [],
            animals: e.animals ?? [],
            hostiles: e.hostiles ?? [],
          };
          setPlayers(next.players);
          setAnimals(next.animals);
          setHostiles(next.hostiles);
          setLastLiveUpdate(next.at);
          setHistory((old) => {
            const updated = [...old, { at: next.at, players: next.players, animals: [], hostiles: [] }]
              .filter((x) => x.at > Date.now() - HISTORY_RETENTION_MS)
              .slice(-MAX_HISTORY);
            persistPlayerHistory(updated);
            return updated;
          });
          const errors = (e.errors || {}) as Record<string, string>;
          setFeedError(
            [errors.players, errors.hostiles, errors.animals]
              .filter(Boolean)
              .join(" · ") || "",
          );
        })
        .catch((e) => active && setFeedError(e.message));
      void get("claims-live")
        .then((c) => {
          if (!active || prismaClaimsActiveRef.current) return;
          setClaims(c.claims ?? []);
        })
        .catch((e) => active && !prismaClaimsActiveRef.current && setFeedError(`Claims: ${e.message}`));
      void get("regions-live")
        .then((r) => active && setRegionFiles(r.regions ?? []))
        .catch((e) => active && setFeedError(`Regions: ${e.message}`));
      void get("api/serverstats")
        .then((s) => {
          if (!active) return;
          const t = s.gameTime;
          setGameTime(
            t
              ? `Day ${t.days}, ${String(t.hours).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")}`
              : "",
          );
        })
        .catch(() => undefined);
      void get("visitmap-status")
        .then((status) => active && setVisitStatus(status))
        .catch(() => undefined);
    };
    loadConfig();
    loadWorldInfo();
    update();
    const timer = setInterval(update, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, server?.id]);
  useEffect(() => {
    if (!ready || !orgId) return;
    api
      .get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`)
      .then((rows) => {
        const gameServers = rows.filter((candidate) => candidate.gameType === "minecraft" || candidate.gameType === "7dtd");
        const preferred = gameServers.filter((c) => c.gameType === "minecraft");
        const ordered = preferred.length ? preferred : gameServers;
        setServers(ordered);
        setServer(ordered.find((candidate) => candidate.id === getStoredServerId()) ?? ordered[0] ?? null);
      })
      .catch(() => setVisitNotice("Could not load registered game servers."));
  }, [ready, orgId]);
  useEffect(() => {
    if (!ready || !orgId) return;
    let active = true;
    const loadPrisma = async () => {
      try {
        const status = await api.get<{ configured?: boolean; reachable?: boolean }>(
          `/api/orgs/${orgId}/prismacore/status`,
        );
        if (!active) return;
        const configured = Boolean(status.configured);
        prismaConfiguredRef.current = configured;
        setPrismaConfigured(configured);
        if (!configured) {
          prismaClaimsActiveRef.current = false;
          return;
        }
        const [land, vehicleRows, droneRows, traderRows, homeRows, questRows, resetRows, advRows, allPoiRows] =
          await Promise.all([
            api.get<{ reachable?: boolean; claims?: Claim[] }>(`/api/orgs/${orgId}/prismacore/landclaims`),
            api.get<{ markers?: PrismaMarker[] }>(`/api/orgs/${orgId}/prismacore/vehicles`),
            api.get<{ markers?: PrismaMarker[] }>(`/api/orgs/${orgId}/prismacore/drones`),
            api.get<{ markers?: PrismaMarker[] }>(`/api/orgs/${orgId}/prismacore/traders`),
            api.get<{ homes?: PrismaHome[] }>(`/api/orgs/${orgId}/prismacore/playerhomes`),
            api.get<{ pois?: PrismaPoi[] }>(`/api/orgs/${orgId}/prismacore/questpois`),
            api.get<{ regions?: PrismaRect[] }>(`/api/orgs/${orgId}/prismacore/resetregions`),
            api.get<{ claims?: PrismaRect[] }>(`/api/orgs/${orgId}/prismacore/advclaims`),
            api.get<{ pois?: PrismaPoi[] }>(`/api/orgs/${orgId}/prismacore/allpois`),
          ]);
        if (!active) return;
        if (land.reachable) {
          prismaClaimsActiveRef.current = true;
          setClaims(land.claims ?? []);
        } else {
          prismaClaimsActiveRef.current = false;
        }
        setVehicles(vehicleRows.markers ?? []);
        setDrones(droneRows.markers ?? []);
        setTraders(traderRows.markers ?? []);
        setHomes(homeRows.homes ?? []);
        setQuestPois(questRows.pois ?? []);
        setResetRegions(resetRows.regions ?? []);
        setAdvClaims(advRows.claims ?? []);
        setAllPois(allPoiRows.pois ?? []);
      } catch {
        if (!active) return;
        prismaConfiguredRef.current = false;
        prismaClaimsActiveRef.current = false;
        setPrismaConfigured(false);
      }
    };
    void loadPrisma();
    const timer = setInterval(() => void loadPrisma(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, orgId]);
  useEffect(() => {
    if (!ready || !orgId || !server) {
      setLogoutMarkers([]);
      return;
    }
    let active = true;
    const load = () =>
      api
        .get<PlayerRecord[]>(`/api/orgs/${orgId}/players?serverInstanceId=${encodeURIComponent(server.id)}`)
        .then((rows) => {
          if (!active) return;
          setLogoutMarkers(
            rows
              .filter((player) => !player.online && player.lastPosX != null && player.lastPosZ != null)
              .map((player) => ({
                id: player.id,
                name: player.name,
                x: player.lastPosX as number,
                y: player.lastPosY,
                z: player.lastPosZ as number,
                lastLogoutAt: player.lastLogoutAt,
              })),
          );
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, orgId, server]);
  // Keep CRS identity stable across polling/history renders. Leaflet treats a
  // changed CRS as a viewport reset, which can look like random zooming.
  const divisor = 2 ** (config?.maxZoom ?? 4);
  const crs = useMemo(() => L.extend({}, L.CRS.Simple, {
    projection: {
      project: (p: L.LatLng) => new L.Point(p.lat / divisor, p.lng / divisor),
      unproject: (p: L.Point) => new L.LatLng(p.x * divisor, p.y * divisor),
      bounds: L.bounds([-Infinity, -Infinity], [Infinity, Infinity]),
    },
    transformation: new L.Transformation(1, 0, -1, 0),
    scale: (zoom: number) => 2 ** zoom,
  }) as L.CRS, [divisor]);
  const playerChoices = useMemo(
    () =>
      dedupePlayerChoices((() => {
        const byKey = new Map<string, Entity>();
        for (const snapshot of history) {
          for (const player of snapshot.players) byKey.set(playerTrackKey(player), player);
        }
        for (const player of players) byKey.set(playerTrackKey(player), player);
        return [...byKey.values()];
      })()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })),
    [history, players],
  );
  useEffect(() => {
    if (!trackedPlayer) return;
    if (playerChoices.some((player) => playerTrackKey(player) === trackedPlayer)) return;
    const legacyName = trackedPlayer.startsWith("name:") ? trackedPlayer.slice(5) : null;
    if (!legacyName) return;
    const match = playerChoices.find((player) => String(player.name || "").trim().toLocaleLowerCase() === legacyName);
    if (match) setTrackedPlayer(playerTrackKey(match));
  }, [trackedPlayer, playerChoices]);

  async function sendVisitCommand(command: string, successMessage: string) {
    if (!orgId || !server || visitBusy) return;
    setVisitBusy(true);
    setVisitNotice("");
    try {
      await api.post<{ ok: boolean; command: string; result?: string }>(
        `/api/orgs/${orgId}/allocs/console`,
        { command },
      );
      if (command.startsWith("visitmap ") && command !== "visitmap stop") {
        setVisitStatus({ state: "running", percent: 0 });
      }
      setVisitNotice(successMessage);
    } catch (commandError) {
      setVisitNotice(
        commandError instanceof Error ? commandError.message : "visitmap command failed.",
      );
    } finally {
      setVisitBusy(false);
    }
  }

  async function stopVisitMap() {
    await sendVisitCommand("visitmap stop", "Stop command delivered; verifying server progress…");
    window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/live-map/visitmap-status?serverInstanceId=${encodeURIComponent(server?.id || "")}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "Status unavailable");
        const status = (body.data ?? body) as VisitMapStatus;
        setVisitStatus(status);
        setVisitNotice(
          status.state === "stopped" || status.state === "idle" || status.state === "complete"
            ? "Map generation is not running."
            : status.state === "stalled"
              ? "Stop was sent, but the stalled game thread has not processed it. A server restart may be required."
              : "Stop was sent, but map generation is still reporting progress.",
        );
      } catch (statusError) {
        setVisitNotice(statusError instanceof Error ? statusError.message : "Could not verify visitmap status.");
      }
    }, 3500);
  }
  if (error)
    return (
      <div>
        <h1>Live Server Map</h1>
        <div
          style={{
            padding: "1rem",
            background: "#3f1d25",
            color: "#fca5a5",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      </div>
    );
  if (!config)
    return (
      <div>
        <h1>Live Server Map</h1>
        <p style={{ color: "#64748b" }}>Connecting to the 7DTD map renderer…</p>
      </div>
    );
  if (!config.enabled)
    return (
      <div>
        <h1>Live Server Map</h1>
        <p style={{ color: "#fbbf24" }}>
          Map rendering is disabled in serverconfig.xml. Enable it and restart
          7DTD.
        </p>
      </div>
    );
  const size = config.mapSize || { x: 8192, y: 255, z: 8192 };
  const visitWidth = Math.floor(worldInfo?.width || size.x);
  const visitHeight = Math.floor(worldInfo?.height || size.z);
  const worldX1 = -Math.floor(visitWidth / 2);
  const worldZ1 = -Math.floor(visitHeight / 2);
  const worldX2 = worldX1 + visitWidth - 1;
  const worldZ2 = worldZ1 + visitHeight - 1;
  const sectionColumn = visitSection % 4;
  const sectionRow = Math.floor(visitSection / 4);
  const sectionWidth = Math.ceil(visitWidth / 4);
  const sectionHeight = Math.ceil(visitHeight / 4);
  const visitX1 = worldX1 + sectionColumn * sectionWidth;
  const visitX2 = Math.min(worldX2, visitX1 + sectionWidth - 1);
  const visitZ2 = worldZ2 - sectionRow * sectionHeight;
  const visitZ1 = Math.max(worldZ1, visitZ2 - sectionHeight + 1);
  const visitCommand = `visitmap ${visitX1} ${visitZ1} ${visitX2} ${visitZ2}`;
  const fullVisitCommand = `visitmap ${worldX1} ${worldZ1} ${worldX2} ${worldZ2}`;
  const visitRunning = visitStatus.state === "running" || visitStatus.state === "stalled";
  const visitBlocked = players.length > 0 || visitRunning;
  const regionDefinitions = regionFiles.length
    ? regionFiles
    : Array.from(
        { length: Math.ceil(size.x / 512) * Math.ceil(size.z / 512) },
        (_, index) => {
          const width = Math.ceil(size.z / 512);
          const x = Math.floor(-size.x / 1024) + Math.floor(index / width);
          const z = Math.floor(-size.z / 1024) + (index % width);
          return { name: `r.${x}.${z}.7rg`, x, z };
        },
      );
  const mapBounds = L.latLngBounds([worldX1, worldZ1], [worldX2, worldZ2]);
  const windowedHistory = history
    .filter((snapshot) => snapshot.at >= Date.now() - historyWindow * 60_000)
    .slice()
    .sort((a, b) => a.at - b.at);
  const historyStart = windowedHistory[0]?.at;
  const historyEnd = windowedHistory[windowedHistory.length - 1]?.at;
  const replaying = historyCursorAt != null;
  const replaySnapshot = replaying
    ? snapshotAtOrBefore(windowedHistory, historyCursorAt) || snapshotAtOrBefore(history, historyCursorAt)
    : null;
  const viewed = replaySnapshot
    ? replaySnapshot
    : replaying
      ? { at: historyCursorAt, players: [] as Entity[], animals: [] as Entity[], hostiles: [] as Entity[] }
      : { at: Date.now(), players, animals, hostiles };
  const replayLayerKey = replaying ? `replay-${viewed.at}` : "live";
  const replayIndex = !replaying
    ? windowedHistory.length
    : Math.max(
        0,
        windowedHistory.findIndex((snapshot) => snapshot.at === viewed.at),
      );
  const normalizedEntitySearch = entitySearch.trim().toLocaleLowerCase();
  const matchesEntity = (...values: unknown[]) => !normalizedEntitySearch || values.some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedEntitySearch));
  const tracking = Boolean(trackedPlayer);
  const visibleAdvClaims = tracking || !showAdvClaims ? [] : (advClaimFilter === "all" ? advClaims : advClaims.filter((claim) => claim.type === advClaimFilter)).filter((claim) => matchesEntity(claim.name, claim.type, claim.id));
  const visiblePlayers = viewed.players.filter((entity) => (!tracking || playerTrackKey(entity) === trackedPlayer) && (tracking || matchesEntity(entity.name, entity.id, entity.steamId)));
  const visibleAnimals = tracking ? [] : viewed.animals.filter((entity) => matchesEntity(entity.name, entity.id));
  const visibleHostiles = tracking ? [] : viewed.hostiles.filter((entity) => matchesEntity(entity.name, entity.id));
  const visibleClaims = tracking || !showClaims ? [] : claims.filter((claim) => matchesEntity(claim.owner, claim.steamId, claim.eosId, claim.id));
  const visibleVehicles = tracking || !showVehicles ? [] : vehicles.filter((marker) => matchesEntity(marker.name, marker.extra, marker.id));
  const visibleDrones = tracking || !showDrones ? [] : drones.filter((marker) => matchesEntity(marker.name, marker.extra, marker.id));
  const visibleTraders = tracking || !showTraders ? [] : traders.filter((marker) => matchesEntity(marker.name, marker.extra, marker.id));
  const visibleHomes = tracking || !showBeds ? [] : homes.filter((home) => matchesEntity(home.owner, home.steamId, home.id));
  const visibleRegions = tracking ? [] : regionDefinitions.filter((region) => matchesEntity(region.name, region.x, region.z));
  const visibleQuestPois = tracking || !showQuestPois ? [] : questPois.filter((poi) => matchesEntity(poi.name, poi.id));
  const visibleAllPois = tracking || !showAllPois ? [] : allPois.filter((poi) => matchesEntity(poi.name, poi.id));
  const visibleResetRegions = tracking || !showResetRegions ? [] : resetRegions;
  const regions = visibleRegions.map((region) => {
    const x0 = region.x * 512,
      z0 = region.z * 512;
    return (
      <Rectangle key={region.name} bounds={[[x0, z0], [x0 + 512, z0 + 512]]} pathOptions={{ color: "#94a3b8", weight: 1, fill: false }}>
        <Tooltip permanent direction="center" opacity={0.9} interactive={false} className="region-grid-label">
          {region.name}
        </Tooltip>
      </Rectangle>
    );
  });
  const liveSnapshot: Snapshot = { at: Date.now(), players, animals: [], hostiles: [] };
  const trailSource = tracking
    ? history.filter((snapshot) => historyCursorAt === null || snapshot.at <= historyCursorAt)
    : windowedHistory;
  const trailHistory = [
    ...trailSource,
    ...(historyCursorAt === null && players.length ? [liveSnapshot] : []),
  ].sort((a, b) => a.at - b.at);
  const visibleIds = showAllPlayerTrails && !tracking
    ? [...new Set(trailHistory.flatMap((s) => s.players.map(playerTrackKey)))]
    : tracking
      ? [trackedPlayer]
      : [...new Set(viewed.players.map(playerTrackKey))];
  const trails = visibleIds
    .map((id) => {
      const points = trailHistory.flatMap((s) =>
        s.players
          .filter((p) => playerTrackKey(p) === id)
          .filter((p) => Number.isFinite(p.position?.x) && Number.isFinite(p.position?.z))
          .map((p) => [p.position.x, p.position.z] as [number, number]),
      );
      const distinct = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
      return { id, points: sampleTrail(distinct) };
    })
    .filter((trail) => trail.points.length > 1);
  const trackedOnline = viewed.players.find((player) => playerTrackKey(player) === trackedPlayer) || null;
  const trackedTrail = trails.find((trail) => trail.id === trackedPlayer);
  const followPosition = trackedOnline
    ? [trackedOnline.position.x, trackedOnline.position.z] as [number, number]
    : trackedTrail?.points[trackedTrail.points.length - 1] ?? null;
  const filterPanelProps: MapFilterPanelProps = {
    prismaConfigured,
    viewed,
    claims,
    logoutMarkers,
    vehicles,
    drones,
    homes,
    traders,
    questPois,
    allPois,
    resetRegions,
    advClaims,
    showTrailsLayer,
    setShowTrailsLayer,
    showPlayersLayer,
    setShowPlayersLayer,
    showAnimalsLayer,
    setShowAnimalsLayer,
    showHostilesLayer,
    setShowHostilesLayer,
    showAllPlayerTrails,
    setShowAllPlayerTrails,
    showPlayerNames,
    setShowPlayerNames,
    showLogoutLocations,
    setShowLogoutLocations,
    showClaims,
    setShowClaims,
    showVehicles,
    setShowVehicles,
    showDrones,
    setShowDrones,
    showBeds,
    setShowBeds,
    showTraders,
    setShowTraders,
    showQuestPois,
    setShowQuestPois,
    showAllPois,
    setShowAllPois,
    showResetRegions,
    setShowResetRegions,
    showAdvClaims,
    setShowAdvClaims,
    showRegionGrid,
    setShowRegionGrid,
    advClaimFilter,
    setAdvClaimFilter,
  };
  const resetFilters = () => resetMapFilters({
    setTrackedPlayer,
    setShowAllPlayerTrails,
    setShowTrailsLayer,
    setShowPlayersLayer,
    setShowAnimalsLayer,
    setShowHostilesLayer,
    setShowRegionGrid,
    setShowPlayerNames,
    setShowLogoutLocations,
    setShowClaims,
    setShowVehicles,
    setShowDrones,
    setShowBeds,
    setShowTraders,
    setShowQuestPois,
    setShowResetRegions,
    setShowAdvClaims,
    setShowAllPois,
    setEntitySearch,
    setAdvClaimFilter,
    setHistoryCursorAt,
  });
  return (
    <div className="live-map-page">
      <style jsx global>{`
        .live-map-page { color: #e2e8f0; }
        .map-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
        .map-heading h1 { margin: 0; font-size: 1.15rem; }
        .map-stats { display: flex; flex-wrap: wrap; gap: 6px; }
        .map-stat { border: 1px solid #334155; border-radius: 999px; padding: 3px 8px; background: rgba(15,23,42,.7); font-size: 11px; }
        .map-toolbar { margin: 0 0 8px; padding: 8px 10px; background: #111118; border: 1px solid #252532; border-radius: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .map-toolbar .toolbar-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-right: 8px; margin-right: 2px; border-right: 1px solid #293241; }
        .map-toolbar .toolbar-group:last-child { border-right: 0; }
        .map-filter-details { position: relative; display: block; padding-right: 8px; margin-right: 2px; border-right: 1px solid #293241; }
        .map-filter-details summary { cursor: pointer; color: #cbd5e1; font-size: 12px; font-weight: 600; padding: 6px 10px; border: 1px solid #334155; border-radius: 6px; list-style: none; white-space: nowrap; user-select: none; }
        .map-filter-details summary::-webkit-details-marker { display: none; }
        .map-filter-details summary::before { content: "☰ "; opacity: 0.85; }
        .map-filter-details[open] summary { border-color: #38bdf8; background: rgba(30, 41, 59, 0.55); }
        .map-filter-panel, .map-overlay-filters-panel {
          padding: 12px 14px; border: 1px solid #475569; border-radius: 8px;
          background: rgba(15, 23, 42, 0.98); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
          display: grid; gap: 10px; overflow-x: hidden; overflow-y: auto;
          max-height: min(640px, calc(100vh - 160px)); min-height: 220px;
          -webkit-overflow-scrolling: touch;
        }
        .map-filter-details .map-filter-panel {
          position: absolute; top: calc(100% + 6px); left: 0; z-index: 1400;
          width: min(380px, calc(100vw - 48px));
        }
        .map-filter-section, .map-overlay-filters-section { display: grid; gap: 8px; }
        .map-filter-section + .map-filter-section, .map-overlay-filters-section + .map-overlay-filters-section { border-top: 1px solid #334155; padding-top: 10px; margin-top: 2px; }
        .map-filter-section strong, .map-overlay-filters-section strong { color: #94a3b8; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
        .map-filter-grid, .map-overlay-filters-grid { display: grid; gap: 8px; }
        .map-filter-grid label, .map-overlay-filters-grid label { min-height: 24px; align-items: center !important; }
        .map-overlay-filters { position: absolute; top: 10px; right: 10px; z-index: 1200; }
        .map-overlay-filters-toggle {
          width: 40px; height: 40px; border: 1px solid #475569; border-radius: 7px;
          background: rgba(15, 23, 42, 0.96); color: #e2e8f0; font-size: 18px; line-height: 1;
          cursor: pointer; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
        }
        .map-overlay-filters-toggle[aria-expanded="true"] { border-color: #38bdf8; background: #1e293b; }
        .map-overlay-filters-panel {
          position: fixed; z-index: 2000; width: min(380px, calc(100vw - 24px));
        }
        .map-toolbar select, .map-toolbar button { min-height: 32px; }
        .map-toolbar button:focus-visible, .map-toolbar select:focus-visible, .map-toolbar input:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        .map-maintenance { min-width: min(100%, 280px); }
        .map-maintenance summary { cursor: pointer; color: #94a3b8; font-size: 12px; font-weight: 600; padding: 6px 8px; border: 1px solid #3f3f46; border-radius: 6px; background: rgba(15,23,42,.45); list-style-position: inside; }
        .map-maintenance[open] summary { border-radius: 6px 6px 0 0; color: #fbbf24; }
        .map-maintenance > div { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 8px; }
        .map-frame { position: relative; height: calc(100vh - 148px); min-height: 560px; border: 1px solid #334155; border-radius: 12px; overflow: hidden; box-shadow: 0 14px 35px rgba(0,0,0,.22); }
        .map-empty-state { position: absolute; z-index: 900; top: 12px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 24px); padding: 7px 11px; border: 1px solid #475569; border-radius: 7px; background: rgba(15,23,42,.9); color: #cbd5e1; font-size: 12px; text-align: center; pointer-events: none; }
        .map-viewport-controls { position: absolute; z-index: 1000; top: 10px; left: 10px; display: flex; gap: 5px; }
        .map-viewport-controls button { border: 1px solid #475569; border-radius: 6px; background: rgba(15,23,42,.92); color: #e2e8f0; padding: 6px 8px; font-size: 11px; cursor: pointer; }
        .map-viewport-controls button:hover { background: #1e293b; }
        .map-search-overlay { position: absolute; z-index: 1000; top: 10px; left: 168px; display: flex; align-items: center; gap: 6px; width: min(280px, calc(100% - 220px)); padding: 6px 8px; border: 1px solid #475569; border-radius: 7px; background: rgba(15,23,42,.94); box-shadow: 0 3px 12px rgba(0,0,0,.3); }
        .map-search-overlay input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: #f8fafc; font-size: 12px; }
        .map-search-overlay button { border: 0; border-radius: 5px; background: #334155; color: #e2e8f0; padding: 4px 7px; cursor: pointer; }
        .map-legend { position: absolute; z-index: 1000; right: 10px; bottom: 66px; display: flex; flex-wrap: wrap; gap: 7px 10px; max-width: min(360px, calc(100% - 20px)); padding: 7px 9px; border: 1px solid #475569; border-radius: 7px; background: rgba(15,23,42,.92); color: #cbd5e1; font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
        .map-legend strong { color: #f8fafc; margin-right: 2px; }
        .map-legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
        .map-legend i { width: 8px; height: 8px; display: inline-block; border-radius: 50%; border: 1px solid rgba(255,255,255,.7); }
        .map-track-banner { position: absolute; z-index: 1000; top: 10px; right: 58px; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid ${trackingColor}; border-radius: 7px; background: rgba(15,23,42,.94); color: #f8fafc; font-size: 12px; max-width: calc(100% - 120px); }
        .map-timeline { position: absolute; z-index: 1100; left: 10px; right: 10px; bottom: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #475569; border-radius: 8px; background: rgba(15,23,42,.94); box-shadow: 0 3px 12px rgba(0,0,0,.3); }
        .map-timeline input[type="range"] { flex: 1; min-width: 140px; accent-color: #f59e0b; }
        .map-timeline select, .map-timeline button { min-height: 32px; }
        .map-timeline button:focus-visible, .map-timeline select:focus-visible, .map-timeline input:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        @media (max-width: 700px) {
          .map-toolbar .toolbar-group { width: 100%; border-right: 0; border-bottom: 1px solid #293241; padding: 0 0 8px; }
          .map-toolbar .toolbar-group:last-child { border-bottom: 0; padding-bottom: 0; }
          .map-frame { height: calc(100vh - 220px); min-height: 430px; }
          .map-search-overlay { top: 52px; left: 10px; width: calc(100% - 20px); }
          .map-legend { bottom: 108px; }
        }
      `}</style>
      <div className="map-heading">
        <div>
          <h1>Live Map</h1>
          <div className="map-stats">
            <span className="map-stat" style={{ color: "#60a5fa" }}>Players {viewed.players.length}</span>
            <span className="map-stat" style={{ color: "#c084fc" }}>Claims {claims.length}</span>
            <span className="map-stat" style={{ color: "#fbbf24" }}>Logout {logoutMarkers.length}</span>
            <span className="map-stat" style={{ color: "#4ade80" }}>Animals {viewed.animals.length}</span>
            <span className="map-stat" style={{ color: "#f87171" }}>Hostiles {viewed.hostiles.length}</span>
            {tracking && <span className="map-stat" style={{ color: trackingColor }}>Tracking {trackedOnline?.name || playerChoices.find((p) => playerTrackKey(p) === trackedPlayer)?.name || "player"}</span>}
            {feedError && <span style={{ color: "#fbbf24", fontSize: 12 }}>Feed error: {feedError}</span>}
            {!feedError && <span className="map-stat" role="status" style={{ color: lastLiveUpdate ? "#4ade80" : "#fbbf24" }}>{formatAge(lastLiveUpdate)}</span>}
          </div>
        </div>
        <select aria-label="Server" value={server?.id || ""} onChange={(event) => selectServer(event.target.value)} disabled={!servers.length} style={{ background: "#111118", color: "#e2e8f0", border: "1px solid #475569", borderRadius: 6, padding: "7px 9px", minWidth: 170 }}>
          <option value="">Select server</option>
          {servers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
        <details className="map-maintenance">
          <summary>{gameTime || "Map maintenance"} · {visitRunning ? `generation ${visitStatus.state}` : "generation idle"}</summary>
          <div>
          <select
            aria-label="Map generation section"
            value={visitSection}
            disabled={visitBusy || visitRunning}
            onChange={(event) => setVisitSection(Number(event.target.value))}
            style={{ background: "#0d0d14", color: "#e2e8f0", border: "1px solid #475569", borderRadius: 6, padding: "7px 9px" }}
          >
            {Array.from({ length: 16 }, (_, index) => {
              const row = Math.floor(index / 4) + 1;
              const column = (index % 4) + 1;
              return <option key={index} value={index}>Section {index + 1}/16 · row {row}, column {column}</option>;
            })}
          </select>
          <button
            disabled={!server || !worldInfo || visitBusy || visitBlocked}
            title={
              players.length > 0
                ? `Maintenance-only operation: ${players.length} player${players.length === 1 ? " is" : "s are"} connected`
                : visitRunning
                  ? `visitmap is ${visitStatus.state}`
                : worldInfo
                  ? visitCommand
                  : "Waiting for map_info.xml"
            }
            onClick={() => {
              if (!worldInfo) return;
              const confirmed = window.confirm(
                `Generate section ${visitSection + 1} of 16 for the ${visitWidth.toLocaleString()} × ${visitHeight.toLocaleString()} world?\n\nCommand: ${visitCommand}\n\nThis section covers ${(visitX2 - visitX1 + 1).toLocaleString()} × ${(visitZ2 - visitZ1 + 1).toLocaleString()} blocks. Run one section at a time during maintenance.`,
              );
              if (confirmed)
                void sendVisitCommand(
                  visitCommand,
                  `Map section ${visitSection + 1}/16 started. Tiles will appear progressively; wait for completion before starting another section.`,
                );
            }}
            style={{
              background: !server || !worldInfo || visitBusy || visitBlocked ? "#334155" : "#b45309",
              color: "white",
              border: 0,
              borderRadius: 6,
              padding: "7px 11px",
              cursor: !server || !worldInfo || visitBusy || visitBlocked ? "not-allowed" : "pointer",
            }}
          >
            {visitBusy
              ? "Sending…"
              : players.length > 0
                ? `Wait for ${players.length} online player${players.length === 1 ? "" : "s"}`
                : visitRunning
                  ? `Map generation ${visitStatus.state}`
                  : `Generate section ${visitSection + 1}/16`}
          </button>
          <button
            disabled={!server || !worldInfo || visitBusy || visitBlocked}
            title={
              players.length > 0
                ? `Maintenance-only operation: ${players.length} player${players.length === 1 ? " is" : "s are"} connected`
                : visitRunning
                  ? `visitmap is ${visitStatus.state}`
                  : worldInfo
                    ? `High-load operation: ${fullVisitCommand}`
                    : "Waiting for map_info.xml"
            }
            onClick={() => {
              if (!worldInfo) return;
              const confirmed = window.confirm(
                `Generate the ENTIRE ${visitWidth.toLocaleString()} × ${visitHeight.toLocaleString()} world in one operation?\n\nCommand: ${fullVisitCommand}\n\nWARNING: This is extremely demanding and previously froze the game server before completion. The server may become unresponsive and require a forced restart. Section generation is strongly recommended.\n\nOnly continue during maintenance when no players are connected.`,
              );
              if (confirmed)
                void sendVisitCommand(
                  fullVisitCommand,
                  "Full-world map generation started. The server may respond slowly; monitor progress below and do not start another generation job.",
                );
            }}
            style={{
              background: !server || !worldInfo || visitBusy || visitBlocked ? "#334155" : "#9f1239",
              color: "white",
              border: "1px solid #fb7185",
              borderRadius: 6,
              padding: "7px 11px",
              cursor: !server || !worldInfo || visitBusy || visitBlocked ? "not-allowed" : "pointer",
            }}
          >
            Generate full map
          </button>
          {visitRunning && (
            <button
              disabled={!server || visitBusy}
              title="Stop the current visitmap operation"
              onClick={() => void stopVisitMap()}
              style={{
                background: !server || visitBusy ? "#334155" : "#7f1d1d",
                color: "white",
                border: 0,
                borderRadius: 6,
                padding: "7px 11px",
                cursor: !server || visitBusy ? "not-allowed" : "pointer",
              }}
            >
              Stop map generation
            </button>
          )}
          </div>
        </details>
      </div>
      {visitStatus.state !== "idle" && (
      <div style={{ color: visitStatus.state === "stalled" ? "#fca5a5" : visitStatus.state === "running" ? "#fbbf24" : "#94a3b8", fontSize: 12, marginBottom: 8 }}>
        visitmap: <strong>{visitStatus.state}</strong>
        {visitStatus.total ? ` · ${visitStatus.percent ?? 0}% · ${(visitStatus.done ?? 0).toLocaleString()} / ${visitStatus.total.toLocaleString()} chunks` : ""}
        {visitStatus.estimatedSeconds ? ` · about ${Math.ceil(visitStatus.estimatedSeconds / 60)} minutes remaining` : ""}
      </div>
      )}
      {visitNotice && (
        <div style={{ color: /failed|could not|did not/i.test(visitNotice) ? "#fca5a5" : "#fbbf24", fontSize: 12, marginBottom: 8 }}>
          {visitNotice}
        </div>
      )}
      <div
        className="map-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          marginBottom: 8,
          background: "#111118",
          border: "1px solid #252532",
          borderRadius: 8,
          flexWrap: "wrap",
        }}
      >
          <div className="toolbar-group">
          <select
            aria-label="Track player"
            value={trackedPlayer}
            onChange={(e) => setTrackedPlayer(e.target.value)}
            style={{
              background: "#0d0d14",
              color: "#e2e8f0",
              border: trackedPlayer ? `1px solid ${trackingColor}` : "1px solid #334155",
              borderRadius: 6,
              padding: "6px 9px",
              minWidth: 180,
              maxWidth: 240,
            }}
          >
          <option value="">All players</option>
          {playerChoices.map((p) => (
            <option key={playerTrackKey(p)} value={playerTrackKey(p)}>
              Track {p.name}
            </option>
          ))}
        </select>
          {trackedPlayer && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: trackingColor, fontSize: 12, whiteSpace: "nowrap" }}>
            Trail color
            <input
              type="color"
              aria-label="Tracked player trail color"
              value={trackingColor}
              onChange={(event) => setTrackingColor(event.target.value)}
              style={{ width: 30, height: 26, padding: 0, border: "1px solid #475569", borderRadius: 5, background: "transparent", cursor: "pointer" }}
            />
          </label>
          )}
          </div>
          <details className="map-filter-details">
            <summary>Filters · claims {claims.length} · logout {logoutMarkers.length}</summary>
            <div className="map-filter-panel" role="dialog" aria-label="Map filters">
              <MapFilterPanel {...filterPanelProps} onReset={resetFilters} />
            </div>
          </details>
          <div className="toolbar-group">
        <button
          type="button"
          onClick={resetFilters}
          style={{ background: "#334155", color: "#e2e8f0", border: 0, borderRadius: 6, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          Reset filters
        </button>
          </div>
      </div>
      <div
        className="map-frame"
        style={{
          height: "calc(100vh - 148px)",
          minHeight: 560,
          border: "1px solid #252532",
          borderRadius: 9,
          overflow: "hidden",
        }}
      >
        <div className="map-search-overlay">
          <input
            aria-label="Search map"
            placeholder="Search…"
            value={entitySearch}
            onChange={(event) => setEntitySearch(event.target.value)}
          />
          {entitySearch && <button type="button" aria-label="Clear map search" onClick={() => setEntitySearch("")}>×</button>}
        </div>
        <div className="map-overlay-filters" ref={filtersPanelRef}>
          <button
            ref={filterToggleRef}
            type="button"
            className="map-overlay-filters-toggle"
            aria-label="Map filters"
            aria-expanded={filtersOpen}
            title="Map filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            ☰
          </button>
          {filtersOpen && (
            <div className="map-overlay-filters-panel" style={overlayPanelStyle} role="dialog" aria-label="Map filters">
              <MapFilterPanel
                {...filterPanelProps}
                onReset={() => {
                  resetFilters();
                  setFiltersOpen(false);
                }}
              />
            </div>
          )}
        </div>
        {replaying && (
          <div className="map-track-banner" style={{ borderColor: "#f59e0b", top: tracking ? 48 : 10 }}>
            <strong style={{ color: "#fbbf24" }}>Replay</strong>
            <span style={{ color: "#cbd5e1" }}>{new Date(viewed.at).toLocaleTimeString()} · {viewed.players.length} player{viewed.players.length === 1 ? "" : "s"} online then</span>
            <button type="button" onClick={() => setHistoryCursorAt(null)} style={{ background: "#334155", color: "#e2e8f0", border: 0, borderRadius: 5, padding: "3px 7px", cursor: "pointer" }}>Live</button>
          </div>
        )}
        {tracking && (
          <div className="map-track-banner">
            <strong style={{ color: trackingColor }}>{trackedOnline?.name || "Selected player"}</strong>
            <span style={{ color: "#94a3b8" }}>{replaying ? "at this time" : trackedOnline ? "live" : "last trail"} · other overlays hidden</span>
            <button type="button" onClick={() => setTrackedPlayer("")} style={{ background: "#334155", color: "#e2e8f0", border: 0, borderRadius: 5, padding: "3px 7px", cursor: "pointer" }}>Clear</button>
          </div>
        )}
        {!feedError && viewed.players.length === 0 && viewed.animals.length === 0 && viewed.hostiles.length === 0 && (
          <div className="map-empty-state" role="status">
            {replaying
              ? "No players were online at this time in the collected history."
              : "No live entities reported. Use ☰ Filters in the toolbar or on the map for claims, logout, and other overlays."}
          </div>
        )}
        <MapContainer
          center={[0, 0]}
          zoom={1}
          minZoom={-1}
          maxZoom={5}
          maxBounds={mapBounds.pad(0.12)}
          maxBoundsViscosity={1}
          scrollWheelZoom
          wheelDebounceTime={80}
          wheelPxPerZoomLevel={120}
          crs={crs}
          fadeAnimation={false}
          style={{ height: "100%", width: "100%", background: "#111827" }}
        >
          <TileLayer
            url={`/api/live-map/map/{z}/{x}/{y}.png?serverInstanceId=${encodeURIComponent(server?.id || "")}`}
            tileSize={128}
            minZoom={-1}
            minNativeZoom={0}
            maxNativeZoom={config.maxZoom ?? 4}
            keepBuffer={16}
            updateInterval={50}
            updateWhenIdle={false}
            updateWhenZooming
          />
          {showTrailsLayer && (
            <LayerGroup key={`trails-${replayLayerKey}`}>
              {trails.map((trail) => {
                const selected = Boolean(trackedPlayer) && trail.id === trackedPlayer;
                return (
                  <LayerGroup key={`trail-${trail.id}`}>
                    {selected && <Polyline positions={trail.points} pathOptions={{ color: "#020617", weight: 9, opacity: 0.85 }} />}
                    <Polyline
                      positions={trail.points}
                      pathOptions={{
                        color: selected || tracking ? trackingColor : "#60a5fa",
                        weight: selected || tracking ? 6 : 3,
                        opacity: selected || tracking ? 1 : 0.7,
                      }}
                    />
                  </LayerGroup>
                );
              })}
            </LayerGroup>
          )}
          {showPlayersLayer && (
            <LayerGroup key={`players-${replayLayerKey}`}>
              {visiblePlayers.map((e) => {
                const selected = playerTrackKey(e) === trackedPlayer;
                return (
                  <Marker
                    key={playerTrackKey(e)}
                    position={[e.position.x, e.position.z]}
                    zIndexOffset={selected ? 1000 : 0}
                    icon={selected ? trackedDot(trackingColor) : dot(replaying ? "#38bdf8" : "#3b82f6")}
                  >
                    <Popup>
                      <strong>{e.name}</strong>
                      <br />
                      {Math.round(e.position.x)}, {Math.round(e.position.z)}
                      {replaying && (
                        <>
                          <br />
                          Online at {new Date(viewed.at).toLocaleTimeString()}
                        </>
                      )}
                      {selected && (
                        <>
                          <br />
                          Tracking
                        </>
                      )}
                    </Popup>
                    {(showPlayerNames || selected) && (
                      <Tooltip
                        permanent
                        direction="top"
                        offset={[0, -10]}
                        opacity={1}
                        className="player-map-name"
                      >
                        {e.name}
                      </Tooltip>
                    )}
                  </Marker>
                );
              })}
              {tracking && !trackedOnline && followPosition && (
                <Marker position={followPosition} zIndexOffset={900} icon={trackedDot(trackingColor)}>
                  <Popup>Last known position</Popup>
                  <Tooltip permanent direction="top" offset={[0, -10]} opacity={1}>Last seen</Tooltip>
                </Marker>
              )}
            </LayerGroup>
          )}
          {showAnimalsLayer && (
            <LayerGroup key={`animals-${replayLayerKey}`}>
              {!tracking && visibleAnimals.map((e) => (
                <Marker
                  key={e.id}
                  position={[e.position.x, e.position.z]}
                  icon={dot("#22c55e")}
                >
                  <Popup>{e.name}</Popup>
                </Marker>
              ))}
            </LayerGroup>
          )}
          {showHostilesLayer && (
            <LayerGroup key={`hostiles-${replayLayerKey}`}>
              {!tracking && visibleHostiles.map((e) => (
                <Marker
                  key={e.id}
                  position={[e.position.x, e.position.z]}
                  icon={dot("#ef4444")}
                >
                  <Popup>{e.name}</Popup>
                </Marker>
              ))}
            </LayerGroup>
          )}
          {showRegionGrid && <LayerGroup key={`regions-${replayLayerKey}`}>{regions}</LayerGroup>}
          {!tracking && showClaims && visibleClaims.length > 0 && (
            <LayerGroup>
              {visibleClaims.map((claim) => {
                const half = claim.size / 2;
                return (
                  <LayerGroup key={claim.id}>
                    <Rectangle
                      bounds={[
                        [claim.position.x - half, claim.position.z - half],
                        [claim.position.x + half, claim.position.z + half],
                      ]}
                      pathOptions={{ color: "#a855f7", weight: 2, fill: true, fillColor: "#7e22ce", fillOpacity: 0.16 }}
                    >
                      <Tooltip sticky>
                        <strong>{claim.owner}</strong><br />Protected {claim.size}×{claim.size}<br />
                        Block: {claim.position.x}, {claim.position.y}, {claim.position.z}<br />
                        Steam: {claim.steamId || "Unavailable"}<br />EOS: {claim.eosId}
                      </Tooltip>
                    </Rectangle>
                    <Marker position={[claim.position.x, claim.position.z]} icon={dot("#a855f7")}>
                      <Popup>
                        <strong>{claim.owner}</strong><br />Land Claim Block<br />
                        {claim.position.x}, {claim.position.y}, {claim.position.z}<br />
                        Protection: {claim.size}×{claim.size}<br />Steam: {claim.steamId || "Unavailable"}<br />EOS: {claim.eosId}
                      </Popup>
                    </Marker>
                  </LayerGroup>
                );
              })}
            </LayerGroup>
          )}
          {!tracking && showVehicles && visibleVehicles.map((marker) => (
            <Marker key={marker.id} position={[marker.position.x, marker.position.z]} icon={dot("#38bdf8")}>
              <Popup>Vehicle: {marker.name}<br />{Math.round(marker.position.x)}, {Math.round(marker.position.y)}, {Math.round(marker.position.z)}</Popup>
            </Marker>
          ))}
          {!tracking && showDrones && visibleDrones.map((marker) => (
            <Marker key={marker.id} position={[marker.position.x, marker.position.z]} icon={dot("#f472b6")}>
              <Popup>Drone: {marker.name}<br />{Math.round(marker.position.x)}, {Math.round(marker.position.y)}, {Math.round(marker.position.z)}</Popup>
            </Marker>
          ))}
          {!tracking && showBeds && visibleHomes.map((home) => {
            const bedSize = 15;
            return (
              <LayerGroup key={home.id}>
                <Rectangle
                  bounds={[
                    [home.position.x - bedSize, home.position.z - bedSize],
                    [home.position.x + bedSize, home.position.z + bedSize],
                  ]}
                  pathOptions={{ color: home.active ? "#4ade80" : "#f87171", weight: 1, fillOpacity: 0.12 }}
                >
                  <Tooltip sticky>{home.owner || home.steamId}<br />Bed {home.active ? "active" : "inactive"}</Tooltip>
                </Rectangle>
                <Marker position={[home.position.x, home.position.z]} icon={dot(home.active ? "#4ade80" : "#f87171")}>
                  <Popup>{home.owner || home.steamId}<br />Bedroll {home.active ? "active" : "inactive"}<br />{home.position.x}, {home.position.y}, {home.position.z}</Popup>
                </Marker>
              </LayerGroup>
            );
          })}
          {!tracking && showTraders && visibleTraders.map((marker) => (
            <Marker key={marker.id} position={[marker.position.x, marker.position.z]} icon={dot("#facc15")}>
              <Popup>Trader: {marker.name}<br />{Math.round(marker.position.x)}, {Math.round(marker.position.z)}</Popup>
            </Marker>
          ))}
          {!tracking && showQuestPois && visibleQuestPois.map((poi) => (
            <Rectangle key={poi.id} bounds={poiBounds(poi)} pathOptions={{ color: "#ef4444", weight: 1, fillOpacity: 0.12 }}>
              <Tooltip sticky>{poi.name}<br />{poi.x}, {poi.z}{poi.containsBed ? " · bed/lcb" : ""}</Tooltip>
            </Rectangle>
          ))}
          {!tracking && showAllPois && visibleAllPois.map((poi) => (
            <Rectangle key={poi.id} bounds={poiBounds(poi)} pathOptions={{ color: "#eab308", weight: 1, fillOpacity: 0.08 }}>
              <Tooltip sticky>{poi.name}<br />{poi.x}, {poi.z}</Tooltip>
            </Rectangle>
          ))}
          {!tracking && showResetRegions && visibleResetRegions.map((rect) => (
            <Polygon key={rect.id} positions={rectPolygon(rect)} pathOptions={{ color: "#ef4444", weight: 1, fillOpacity: 0.12 }}>
              <Popup>Reset region. Do not build here.</Popup>
            </Polygon>
          ))}
          {!tracking && showAdvClaims && visibleAdvClaims.map((rect) => (
            <Polygon key={rect.id} positions={rectPolygon(rect)} pathOptions={{ color: "#22d3ee", weight: 1, fillOpacity: 0.12 }}>
              <Popup>{rect.name}<br />Type: {rect.type}</Popup>
            </Polygon>
          ))}
          <FollowTracked active={tracking} position={followPosition} recenterKey={trackedPlayer} />
          {!tracking && showLogoutLocations && logoutMarkers.length > 0 && (
            <LayerGroup>
              {logoutMarkers.map((marker) => (
                <Marker
                  key={`logout-${marker.id}`}
                  position={[marker.x, marker.z]}
                  icon={L.divIcon({
                    className: "",
                    html: `<span style="display:block;width:12px;height:12px;border-radius:50%;background:#0f172a;border:2px solid #f59e0b;box-shadow:0 1px 4px #000"></span>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8],
                  })}
                >
                  <Popup>
                    <strong>{marker.name}</strong>
                    <br />
                    Last logout
                    <br />
                    {Math.round(marker.x)}, {Math.round(marker.y ?? 0)}, {Math.round(marker.z)}
                    {marker.lastLogoutAt && (
                      <>
                        <br />
                        {new Date(marker.lastLogoutAt).toLocaleString()}
                      </>
                    )}
                  </Popup>
                  {showPlayerNames && (
                    <Tooltip permanent direction="top" offset={[0, -8]} opacity={1} className="player-map-name">
                      {marker.name} (logout)
                    </Tooltip>
                  )}
                </Marker>
              ))}
            </LayerGroup>
          )}
          <MapViewportControls bounds={mapBounds} />
          <MapLegend prismaConfigured={prismaConfigured} showLogoutLocations={showLogoutLocations} showClaims={showClaims} />
          <Coordinates />
        </MapContainer>
        <div className="map-timeline">
          <select
            aria-label="Player history timeframe"
            value={historyWindow}
            onChange={(event) => {
              setHistoryWindow(Number(event.target.value));
              setHistoryCursorAt(null);
            }}
            style={{
              background: "#0d0d14",
              color: "#e2e8f0",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "6px 9px",
            }}
          >
            <option value={5}>Last 5 minutes</option>
            <option value={15}>Last 15 minutes</option>
            <option value={30}>Last 30 minutes</option>
            <option value={60}>Last 1 hour</option>
            <option value={120}>Last 2 hours</option>
            <option value={360}>Last 6 hours</option>
            <option value={720}>Last 12 hours</option>
            <option value={1440}>Last 24 hours</option>
            <option value={2880}>Last 48 hours</option>
            <option value={4320}>Last 72 hours</option>
          </select>
          <span
            style={{
              fontSize: 12,
              color: historyCursorAt === null ? "#4ade80" : "#fbbf24",
              minWidth: 92,
              fontWeight: 700,
            }}
          >
            {historyCursorAt === null
              ? "● LIVE"
              : new Date(viewed.at).toLocaleTimeString()}
          </span>
          <input
            aria-label="Map history time"
            type="range"
            min={0}
            max={windowedHistory.length}
            value={replayIndex}
            onChange={(e) => {
              const n = Number(e.target.value);
              setHistoryCursorAt(n === windowedHistory.length ? null : windowedHistory[n]?.at ?? null);
            }}
            disabled={!windowedHistory.length}
            aria-valuetext={historyCursorAt === null ? "Live" : new Date(viewed.at).toLocaleString()}
          />
          <button
            type="button"
            onClick={() => setHistoryCursorAt(null)}
            disabled={historyCursorAt === null}
            style={{
              background: historyCursorAt === null ? "#334155" : "#2563eb",
              color: "white",
              border: 0,
              borderRadius: 6,
              padding: "6px 12px",
              cursor: historyCursorAt === null ? "default" : "pointer",
            }}
          >
            Live
          </button>
          <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>
            {windowedHistory.length} points{historyStart && historyEnd ? ` · ${new Date(historyStart).toLocaleTimeString()}–${new Date(historyEnd).toLocaleTimeString()}` : " · no collected data"}
          </span>
        </div>
      </div>
    </div>
  );
}
