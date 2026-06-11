"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  Suspense,
} from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import Image from "next/image";
import { createClient } from "@/src/lib/supabase/client";
import type { DbMembreRole, MonitorRole } from "@/src/lib/roles";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface DbStation {
  id: number;
  fablab_id: string;
  created_at: string;
  last_seen_at: string | null;
  air_qualite: number | null;
  nom: string;
  placement: number;
}

type StationStatus = "stable" | "medium" | "warning" | "critical" | "offline";
type FablabInfo = { id: string; nom: string; image?: string };

interface Station extends DbStation {
  status: StationStatus;
  desc: string;
  x: number;
  z: number;
}

type AdminLog = {
  id: string;
  fablab_id: string | null;
  actor_membre_id?: string | null;
  actor_personnel_id?: string | null;
  actor_role: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

type AdminMember = {
  id: string;
  auth_id: string | null;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  fablab_ref: string | null;
  role: DbMembreRole | string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// STATUS LOGIC  (indice qualité de l'air)
// ─────────────────────────────────────────────────────────────────────────────
/** Air Quality Sensor v1.3: Optimal < 180 · Moyen 180–259 · Alerte 260–389 · Danger ≥ 390 · Hors ligne = aucune activité récente */
const THRESHOLDS = {
  mediumMin: 180,
  mediumMax: 259,
  alerteMin: 260,
  alerteMax: 389,
  dangerMin: 390,
} as const;

const OFFLINE_TIMEOUT_MS = 10_000;

function isStationOffline(station: DbStation): boolean {
  return (
    !station.last_seen_at ||
    Date.now() - new Date(station.last_seen_at).getTime() > OFFLINE_TIMEOUT_MS
  );
}

function getAirQualityValue(s: DbStation): number | null {
  return typeof s.air_qualite === "number" && Number.isFinite(s.air_qualite)
    ? s.air_qualite
    : null;
}

function computeStatus(s: DbStation): StationStatus {
  if (isStationOffline(s)) return "offline";
  const q = getAirQualityValue(s);
  if (q === null) return "offline";
  if (q >= THRESHOLDS.dangerMin) return "critical";
  if (q >= THRESHOLDS.alerteMin) return "warning";
  if (q >= THRESHOLDS.mediumMin) return "medium";
  return "stable";
}

function buildDesc(s: DbStation, status: StationStatus): string {
  const q = getAirQualityValue(s);
  if (status === "critical")
    return `⚠ Danger (indice ${q} ≥ ${THRESHOLDS.dangerMin}). Risque élevé — intervention ou protection adaptée.`;
  if (status === "warning")
    return `Alerte (indice ${q}, plage ${THRESHOLDS.alerteMin}–${THRESHOLDS.alerteMax}). Aération ou contrôle recommandé.`;
  if (status === "medium")
    return `Moyen (indice ${q}, plage ${THRESHOLDS.mediumMin}–${THRESHOLDS.mediumMax}). Surveillance recommandée.`;
  if (status === "offline")
    return "Hors ligne : aucune activité récente reçue depuis la station.";
  return `Optimal (indice ${q} < ${THRESHOLDS.mediumMin}). Fonctionnement nominal.`;
}

function formatAirQualityValue(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "Aucune donnée";
}

function buildStation(s: DbStation, index: number, total: number): Station {
  const status = computeStatus(s);
  const maxColumns = 4;
  const row = Math.floor(index / maxColumns);
  const col = index % maxColumns;
  const rowStartIndex = row * maxColumns;
  const rowLength = Math.min(maxColumns, total - rowStartIndex);
  const rowCount = Math.ceil(total / maxColumns);
  const spacingX = total <= 3 ? 8 : 7;
  const spacingZ = 8;
  const offsetX = ((rowLength - 1) * spacingX) / 2;
  return {
    ...s,
    status,
    desc: buildDesc(s, status),
    x: col * spacingX - offsetX,
    z: row * spacingZ - (rowCount - 1) * spacingZ / 2,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS MAP
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  stable:   { label: "Optimal",     color: "#22c55e", dot: "bg-emerald-500", priority: 2, emissive: 0.12 },
  medium:   { label: "Moyen",       color: "#eab308", dot: "bg-yellow-500",   priority: 3, emissive: 0.18 },
  warning:  { label: "Alerte",      color: "#f97316", dot: "bg-orange-500",  priority: 4, emissive: 0.22 },
  critical: { label: "Danger",      color: "#ef4444", dot: "bg-red-500",     priority: 5, emissive: 0.45 },
  offline:  { label: "Hors ligne", color: "#64748b", dot: "bg-slate-500",  priority: 1, emissive: 0.04 },
} as const;

const ADMIN_ROLE_OPTIONS: { value: DbMembreRole; label: string; color: string }[] = [
  { value: "etudiant", label: "Etudiant", color: "#94a3b8" },
  { value: "professeur", label: "Professeur", color: "#22c55e" },
  { value: "technicien", label: "Technicien", color: "#60a5fa" },
  { value: "administrateur", label: "Admin", color: "#f59e0b" },
];

// ─────────────────────────────────────────────────────────────────────────────
// THEME TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const THEME = {
  dark: {
    canvasBg:     "#0e1a2e",
    platformColor: "#0d1b30",
    gridCell:     "#1a3255",
    gridSection:  "#1d4ed8",
    panelBg:      "rgba(10,14,24,0.82)",
    panelBorder:  "rgba(255,255,255,0.08)",
    text:         "#f8fafc",
    textMuted:    "rgba(255,255,255,0.35)",
    textSubtle:   "rgba(255,255,255,0.15)",
    inputBg:      "rgba(255,255,255,0.04)",
    inputBorder:  "rgba(255,255,255,0.08)",
  },
  light: {
    canvasBg:     "#d8e4f0",
    platformColor: "#b8cce0",
    gridCell:     "#7a9cbf",
    gridSection:  "#4a7aa8",
    panelBg:      "rgba(255,255,255,0.88)",
    panelBorder:  "rgba(0,0,0,0.08)",
    text:         "#0f172a",
    textMuted:    "rgba(15,23,42,0.45)",
    textSubtle:   "rgba(15,23,42,0.2)",
    inputBg:      "rgba(0,0,0,0.04)",
    inputBorder:  "rgba(0,0,0,0.1)",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3D: MACHINE BOX
// ─────────────────────────────────────────────────────────────────────────────
const BOX_W = 2.55;
const BOX_D = 2.1;
const BOX_H = 3.2;

const STATION_MODEL_URL = "/station.glb";
const STATION_MODEL_SCALE = 1.65;
const STATION_POLL_INTERVAL_MS = 10_000;

type TintableStationMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  userData: {
    baseColor?: THREE.Color;
    baseEmissive?: THREE.Color;
  };
};

function pseudoRandom01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function readStoredFablab(): FablabInfo | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem("oxalys_fablab");
  if (!stored) return null;
  try {
    return JSON.parse(stored) as FablabInfo;
  } catch {
    return null;
  }
}

function CriticalRing({ color }: { color: string }) {
  const r = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!r.current) return;
    const t = (clock.getElapsedTime() % 1.8) / 1.8;
    r.current.scale.setScalar(1 + t * 1.8);
    if (r.current.material instanceof THREE.Material) {
      (r.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.4;
    }
  });
  return (
    <mesh ref={r} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.6, 1.75, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} />
    </mesh>
  );
}

function applyStationMaterial(
  material: THREE.Material,
  color: THREE.Color,
  opacity: number,
  emissiveIntensity: number,
) {
  const tintable = material as TintableStationMaterial;

  material.transparent = opacity < 1;
  material.opacity = opacity;
  material.depthWrite = opacity >= 0.9;

  if (tintable.color instanceof THREE.Color) {
    tintable.userData.baseColor ??= tintable.color.clone();
    tintable.color.copy(tintable.userData.baseColor).lerp(color, 0.18);
  }

  if (tintable.emissive instanceof THREE.Color) {
    tintable.userData.baseEmissive ??= tintable.emissive.clone();
    tintable.emissive.copy(tintable.userData.baseEmissive).lerp(color, 0.7);
    tintable.emissiveIntensity = emissiveIntensity;
  }

  material.needsUpdate = true;
}

function CriticalMaterialPulse({ materials }: { materials: THREE.Material[] }) {
  useFrame(({ clock }) => {
    const pulse = 0.34 + Math.sin(clock.getElapsedTime() * 3.5) * 0.18;
    materials.forEach((material) => {
      const tintable = material as TintableStationMaterial;
      if (tintable.emissive instanceof THREE.Color) {
        tintable.emissiveIntensity = pulse;
      }
    });
  });

  return null;
}

function StationModel({
  color,
  opacity,
  emissiveIntensity,
  isCritical,
}: {
  color: THREE.Color;
  opacity: number;
  emissiveIntensity: number;
  isCritical: boolean;
}) {
  const { scene } = useGLTF(STATION_MODEL_URL);

  const { model, materials } = useMemo(() => {
    const cloned = scene.clone(true);
    const materials: THREE.Material[] = [];

    cloned.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      object.castShadow = true;
      object.receiveShadow = true;

      if (Array.isArray(object.material)) {
        object.material = object.material.map((material) => {
          const clonedMaterial = material.clone();
          materials.push(clonedMaterial);
          return clonedMaterial;
        });
      } else {
        const clonedMaterial = object.material.clone();
        materials.push(clonedMaterial);
        object.material = clonedMaterial;
      }
    });

    return { model: cloned, materials };
  }, [scene]);

  useEffect(() => {
    materials.forEach((material) => applyStationMaterial(material, color, opacity, emissiveIntensity));
  }, [color, emissiveIntensity, materials, opacity]);

  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials]);

  return (
    <>
      <primitive object={model} scale={STATION_MODEL_SCALE} dispose={null} />
      {isCritical && <CriticalMaterialPulse materials={materials} />}
    </>
  );
}

useGLTF.preload(STATION_MODEL_URL);

function StationBox({ station, isSelected, onClick }: {
  station: Station;
  isSelected: boolean;
  onClick: (id: number) => void;
}) {
  const info = STATUS_MAP[station.status];
  const color = useMemo(() => new THREE.Color(info.color), [info.color]);
  const isCritical = station.status === "critical";
  const edgeGeometry = useMemo(() => new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D), []);

  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry]);

  return (
    <group
      position={[station.x, 0, station.z]}
      onClick={(e) => { e.stopPropagation(); onClick(station.id); }}
      onPointerEnter={() => { document.body.style.cursor = "pointer"; }}
      onPointerLeave={() => { document.body.style.cursor = "default"; }}
    >
      <group
        position={[0, 0, 0]}
        onClick={(e) => { e.stopPropagation(); onClick(station.id); }}
      >
        <StationModel
          color={color}
          opacity={station.status === "offline" ? 0.55 : 1}
          emissiveIntensity={isSelected ? 0.55 : isCritical ? 0.4 : info.emissive}
          isCritical={isCritical}
        />
      </group>

      {/* Wireframe edges */}
      <lineSegments position={[0, BOX_H / 2, 0]}>
        <edgesGeometry
          args={[edgeGeometry]}
        />
        <lineBasicMaterial
          color={info.color}
          transparent
          opacity={isSelected ? 0.95 : 0.3}
        />
      </lineSegments>

      {/* Selection ring */}
      {isSelected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.65, 2.1, 48]} />
          <meshBasicMaterial
            color={info.color}
            transparent
            opacity={0.2}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Critical pulse */}
      {isCritical && <CriticalRing color={info.color} />}

      {/* Point light */}
      {(isSelected || isCritical) && (
        <pointLight
          position={[0, BOX_H + 1, 0]}
          color={info.color}
          intensity={isSelected ? 4 : 2.5}
          distance={6}
          decay={2}
        />
      )}

      {/* HTML label */}
      <Html
        position={[0, BOX_H + 0.6, 0]}
        center
        distanceFactor={14}
        style={{ pointerEvents: "none" }}
      >
        <div style={{ textAlign: "center", whiteSpace: "nowrap", fontFamily: "system-ui" }}>
          <div
            style={{
              fontSize: "9px",
              fontWeight: 800,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: isSelected ? "#fff" : "rgba(255,255,255,0.55)",
              textShadow: isSelected
                ? `0 0 14px ${info.color}, 0 1px 4px rgba(0,0,0,0.9)`
                : "0 1px 4px rgba(0,0,0,0.9)",
            }}
          >
            {station.nom}
          </div>
          {isSelected && (
            <div
              style={{
                fontSize: "8px",
                fontWeight: 700,
                color: info.color,
                marginTop: "2px",
                letterSpacing: "0.05em",
              }}
            >
              ● {info.label}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D: PLATFORM + GRID
// ─────────────────────────────────────────────────────────────────────────────
function Platform({ isDark }: { isDark: boolean }) {
  const t = isDark ? THEME.dark : THEME.light;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial
          color={t.platformColor}
          metalness={0.75}
          roughness={0.3}
        />
      </mesh>

      {/* Edge accent lights */}
      {([-12, 12] as const).flatMap((v) =>
        ([-12, 12] as const).map((w) => (
          <pointLight
            key={`${v}${w}`}
            position={[v, 0.2, w]}
            color={isDark ? "#1e40af" : "#4a7aa8"}
            intensity={1.2}
            distance={8}
            decay={2}
          />
        ))
      )}
    </>
  );
}

function FloatingParticles() {
  const pts = useRef<THREE.Points>(null);
  const count = 80;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (pseudoRandom01(i * 3 + 1) - 0.5) * 24;
      arr[i * 3 + 1] = pseudoRandom01(i * 3 + 2) * 6;
      arr[i * 3 + 2] = (pseudoRandom01(i * 3 + 3) - 0.5) * 24;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (pts.current) pts.current.rotation.y = clock.getElapsedTime() * 0.015;
  });

  return (
    <points ref={pts}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#4f8fd4" size={0.04} transparent opacity={0.45} sizeAttenuation />
    </points>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D: SCENE
// ─────────────────────────────────────────────────────────────────────────────
function Scene3D({
  stations,
  selectedId,
  onSelect,
  isDark,
}: {
  stations: Station[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  isDark: boolean;
}) {
  const { camera } = useThree();
  const t = isDark ? THEME.dark : THEME.light;

  useEffect(() => {
    camera.position.set(16, 12, 16);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <>
      <ambientLight intensity={isDark ? 0.22 : 0.7} />
      <directionalLight
        position={[10, 18, 10]}
        intensity={isDark ? 1.8 : 2.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <pointLight
        position={[-8, 10, -8]}
        color={isDark ? "#3b6fd4" : "#6096c4"}
        intensity={1.2}
        distance={22}
        decay={2}
      />

      <Platform isDark={isDark} />

      {/* Grid — key forces remount on theme change so colors update */}
      <Grid
        key={isDark ? "dark" : "light"}
        position={[0, 0.005, 0]}
        args={[30, 30]}
        cellSize={1}
        cellThickness={0.5}
        cellColor={t.gridCell}
        sectionSize={4}
        sectionThickness={1.0}
        sectionColor={t.gridSection}
        fadeDistance={80}
        fadeStrength={1.2}
        followCamera={false}
        infiniteGrid={false}
      />

      <FloatingParticles />

      {stations.map((s) => (
        <StationBox
          key={s.id}
          station={s}
          isSelected={s.id === selectedId}
          onClick={onSelect}
        />
      ))}

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={7}
        maxDistance={80}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.7}
        zoomSpeed={0.85}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
export default function OxalysDashboard() {
  const router = useRouter();
  const [isDark, setIsDark] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [fablab, setFablab] = useState<FablabInfo | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [loadingStations, setLoadingStations] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [monitorRole, setMonitorRole] = useState<MonitorRole | null>(null);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [adminLogs, setAdminLogs] = useState<AdminLog[]>([]);
  const [adminMembers, setAdminMembers] = useState<AdminMember[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const fablabIdRef = useRef<string | null>(null);

  const theme = isDark ? THEME.dark : THEME.light;

  /* ── Hydrate fablab from localStorage after mount (avoids SSR mismatch) ── */
  useEffect(() => {
    let active = true;

    const hydrateFablab = async () => {
      await Promise.resolve();
      if (!active) return;

      const storedFablab = readStoredFablab();
      if (!storedFablab) {
        setLoadingStations(false);
        router.replace("/connexion");
        return;
      }

      setFablab(storedFablab);
      setLoadingStations(true);
    };

    void hydrateFablab();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!fablab?.id) return;
    let active = true;

    const checkAccess = async () => {
      const response = await fetch("/api/auth/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fablabId: fablab.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok) {
        localStorage.removeItem("oxalys_fablab");
        localStorage.removeItem("oxalys_monitor_role");
        router.replace("/connexion?error=handoff");
        return;
      }
      setMonitorRole(payload.role as MonitorRole);
      localStorage.setItem("oxalys_monitor_role", payload.role);
    };

    checkAccess().catch(() => router.replace("/connexion?error=handoff"));
    return () => {
      active = false;
    };
  }, [fablab?.id, router]);

  /* ── Load fablab + stations + polling toutes les 10s ── */
  useEffect(() => {
    const fid = fablab?.id;
    if (!fid) return;
    fablabIdRef.current = fid;

    const supabase = createClient();

    /* Fetch (initial + polling) */
    const fetchStationsInternal = async (isInitial = false) => {
      const fid = fablabIdRef.current;
      if (!fid) return;

      const { data, error } = await supabase
        .from("station")
        .select("*")
        .eq("fablab_id", fid)
        .order("placement", { ascending: true })
        .order("id", { ascending: true });

      if (error || !data) return;

      const raw = data as DbStation[];

      setStations((prev) => {
        /* Preserve positions already assigned */
        const previousById = new Map(prev.map((s) => [s.id, s]));

        const next = raw.map((s, i) => {
          const existing = previousById.get(s.id);
          const status = computeStatus(s);
          const pos = existing ? { x: existing.x, z: existing.z } : (() => {
            const station = buildStation(s, i, raw.length);
            return { x: station.x, z: station.z };
          })();
          return {
            ...(existing ?? buildStation(s, i, raw.length)),
            air_qualite: s.air_qualite,
            last_seen_at: s.last_seen_at,
            nom: s.nom,
            placement: s.placement,
            status,
            desc: buildDesc(s, status),
            x: pos.x,
            z: pos.z,
          };
        });

        const unchanged =
          next.length === prev.length &&
          next.every((station, index) => {
            const previous = prev[index];
            return (
              previous?.id === station.id &&
              previous.air_qualite === station.air_qualite &&
              previous.last_seen_at === station.last_seen_at &&
              previous.nom === station.nom &&
              previous.placement === station.placement &&
              previous.status === station.status &&
              previous.desc === station.desc &&
              previous.x === station.x &&
              previous.z === station.z
            );
          });

        return unchanged ? prev : next;
      });

      setLastUpdate(new Date());

      if (isInitial) {
        setLoadingStations(false);
        /* Auto-select first station only on the first load */
        if (raw.length > 0) {
          setSelectedId((prev) => (prev === null ? raw[0].id : prev));
        }
      }
    };

    /* The initial load */
    fetchStationsInternal(true).catch(console.error);

    /* Polling every 10 seconds */
    const interval = setInterval(() => {
      fetchStationsInternal(false).catch(console.error);
    }, STATION_POLL_INTERVAL_MS);

    /* Realtime (bonus — fonctionne si activé dans Supabase) */
    const channel = supabase
      .channel("stations-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "station" },
        () => {
          fetchStationsInternal(false).catch(console.error);
        }   // on réutilise le même fetch
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [fablab?.id]);

  const sortedStations = useMemo(
    () =>
      [...stations].sort(
        (a, b) =>
          a.placement - b.placement || a.id - b.id
      ),
    [stations]
  );

  const selectedStation = useMemo(
    () => stations.find((s) => s.id === selectedId) ?? null,
    [stations, selectedId]
  );

  const criticalCount = useMemo(() => stations.filter((s) => s.status === "critical").length, [stations]);

  const loadAdminPanel = async () => {
    if (monitorRole !== "admin") return;
    setAdminLoading(true);
    try {
      const response = await fetch("/api/admin");
      const payload = await response.json();
      if (!response.ok) return;
      setAdminLogs(payload.logs ?? []);
      setAdminMembers(payload.members ?? []);
    } finally {
      setAdminLoading(false);
    }
  };

  const updateMemberRole = async (memberId: string, role: DbMembreRole) => {
    const response = await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, role }),
    });
    if (response.ok) await loadAdminPanel();
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem("oxalys_fablab");
    localStorage.removeItem("oxalys_monitor_role");
    router.push("/connexion");
    router.refresh();
  };

  /* ── Dynamic panel styles ── */
  const glassPanelStyle = useMemo(() => ({
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    backdropFilter: "blur(28px)",
    WebkitBackdropFilter: "blur(28px)",
  }), [theme.panelBg, theme.panelBorder]);

  return (
    <div
      className="h-screen w-screen overflow-hidden relative font-sans transition-colors duration-700"
      style={{ color: theme.text, background: theme.canvasBg }}
    >
      {/* ── THREE.JS CANVAS ── */}
      <div
        className="absolute inset-0 transition-colors duration-700"
        style={{ background: theme.canvasBg }}
      >
        <Canvas
          shadows
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          camera={{ fov: 50, near: 0.1, far: 500 }}
        >
          <Suspense fallback={null}>
            <Scene3D
              stations={stations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              isDark={isDark}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* ── HEADER ── */}
      <header className="absolute top-0 left-0 right-0 z-20 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Logo + FabLab */}
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex items-center gap-3 rounded-2xl px-4 py-2.5"
            style={glassPanelStyle}
          >
            <Image
              src={isDark ? "/oxalys-monitor-light.png" : "/oxalys-monitor.png"}
              alt="Oxalys Monitor"
              width={110}
              height={36}
              className="h-7 w-auto object-contain shrink-0"
              priority
            />
            {fablab && (
              <>
                <div
                  className="w-px h-4 shrink-0"
                  style={{ background: theme.panelBorder }}
                />
                <span
                  className="text-[11px] font-semibold truncate max-w-50"
                  style={{ color: theme.textMuted }}
                >
                  {fablab.nom}
                </span>
              </>
            )}
            {loadingStations && (
              <div
                className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin shrink-0"
                style={{ borderColor: `${theme.panelBorder} transparent` }}
              />
            )}
          </motion.div>

          {/* Right controls */}
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08 }}
            className="flex items-center gap-2"
          >
            {/* LIVE badge */}
            <div
              className="flex items-center gap-2 rounded-xl px-3.5 py-2"
              style={glassPanelStyle}
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                Live
              </span>
              {lastUpdate && (
                <span
                  className="text-[8px] font-mono hidden sm:inline"
                  style={{ color: theme.textSubtle }}
                >
                  {lastUpdate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
            </div>

            {/* Critical alert */}
            <AnimatePresence>
              {criticalCount > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-2 rounded-xl px-3.5 py-2"
                  style={glassPanelStyle}
                >
                  <div className="relative flex shrink-0">
                    <span className="absolute inline-flex h-2 w-2 rounded-full bg-red-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                  </div>
                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider whitespace-nowrap">
                    {criticalCount} en Danger
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {monitorRole === "admin" && (
              <button
                onClick={() => {
                  setIsAdminPanelOpen(true);
                  void loadAdminPanel();
                }}
                className="rounded-xl px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider transition-all"
                style={{ ...glassPanelStyle, color: "#f59e0b" }}
              >
                Panel Admin
              </button>
            )}

            {/* Theme toggle */}
            <button
              onClick={() => setIsDark(!isDark)}
              className="rounded-xl px-3.5 py-2 transition-all flex items-center gap-2.5"
              style={glassPanelStyle}
              title={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
            >
              {/* Moon */}
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  color: isDark ? "#818cf8" : "rgba(0,0,0,0.25)",
                  flexShrink: 0,
                  transition: "color 0.3s",
                }}
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>

              {/* Pill switch */}
              <div
                className="relative shrink-0"
                style={{
                  width: "32px",
                  height: "18px",
                  borderRadius: "9px",
                  background: isDark ? "rgba(255,255,255,0.12)" : "#3b82f6",
                  transition: "background 0.3s",
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(59,130,246,0.5)"}`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: "2px",
                    left: isDark ? "2px" : "14px",
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    background: isDark ? "rgba(255,255,255,0.5)" : "#fff",
                    transition: "left 0.25s cubic-bezier(0.34,1.56,0.64,1)",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  }}
                />
              </div>

              {/* Sun */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  color: isDark ? "rgba(255,255,255,0.35)" : "#f59e0b",
                  flexShrink: 0,
                  transition: "color 0.3s",
                }}
              >
                <circle cx="12" cy="12" r="4" />
                <line x1="12" y1="2" x2="12" y2="4" />
                <line x1="12" y1="20" x2="12" y2="22" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="2" y1="12" x2="4" y2="12" />
                <line x1="20" y1="12" x2="22" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-xl px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
              style={{ ...glassPanelStyle, color: theme.textMuted }}
            >
              {loggingOut ? "..." : "Déconnexion"}
            </button>
          </motion.div>
        </div>
      </header>

      {/* ── STATIONS SIDEBAR (left) ── */}
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, delay: 0.12 }}
        className="absolute left-5 top-1/2 -translate-y-1/2 z-20 w-52.5"
      >
        <div className="rounded-2xl p-3 flex flex-col gap-1" style={glassPanelStyle}>
          <p
            className="text-[8px] font-bold uppercase tracking-[0.35em] px-2 mb-1"
            style={{ color: theme.textSubtle }}
          >
            Stations · {stations.length}
          </p>

          {loadingStations ? (
            <div className="flex flex-col gap-1.5 p-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 rounded-xl animate-pulse"
                  style={{ background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                />
              ))}
            </div>
          ) : stations.length === 0 ? (
            <p
              className="text-[10px] text-center py-4 px-2"
              style={{ color: theme.textMuted }}
            >
              Aucune station associée.
            </p>
          ) : (
            <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
              {sortedStations.map((s, i) => {
                const info = STATUS_MAP[s.status];
                const isSel = s.id === selectedId;
                return (
                  <motion.button
                    key={s.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.05 }}
                    onClick={() => setSelectedId(s.id)}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-200 text-left"
                    style={{
                      background: isSel
                        ? isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"
                        : "transparent",
                      border: isSel
                        ? `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`
                        : "1px solid transparent",
                    }}
                  >
                    <div className="relative shrink-0">
                      {s.status === "critical" && (
                        <span
                          className="absolute inset-0 rounded-full animate-ping"
                          style={{ background: info.color, opacity: 0.5 }}
                        />
                      )}
                      <div
                        className="w-2 h-2 rounded-full relative"
                        style={{ background: info.color }}
                      />
                    </div>
                    <div className="min-w-0">
                      <p
                        className="text-[11px] font-semibold truncate"
                        style={{ color: isSel ? theme.text : theme.textMuted }}
                      >
                        {s.nom}
                      </p>
                      <p
                        className="text-[9px] font-bold uppercase tracking-wider mt-0.5"
                        style={{ color: info.color, opacity: isSel ? 1 : 0.75 }}
                      >
                        {info.label}
                      </p>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </motion.aside>

      {/* ── SELECTED STATION CARD (bottom center) ── */}
      <AnimatePresence>
        {selectedStation && !isPanelOpen && (
          <motion.div
            key={selectedStation.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 w-full px-5"
            style={{ maxWidth: "680px" }}
          >
            <div
              className="rounded-2xl px-6 py-4 flex items-center gap-5"
              style={glassPanelStyle}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: STATUS_MAP[selectedStation.status].color }}
                  />
                  <h3 className="text-sm font-black truncate">{selectedStation.nom}</h3>
                  <span
                    className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: `${STATUS_MAP[selectedStation.status].color}18`,
                      color: STATUS_MAP[selectedStation.status].color,
                      border: `1px solid ${STATUS_MAP[selectedStation.status].color}35`,
                    }}
                  >
                    {STATUS_MAP[selectedStation.status].label}
                  </span>
                </div>
                <p
                  className="text-[11px] leading-relaxed line-clamp-1"
                  style={{ color: theme.textMuted }}
                >
                  {selectedStation.desc}
                </p>
              </div>

              {/* Métrique qualité de l'air */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-center">
                  <p
                    className="text-[8px] font-bold uppercase tracking-wider"
                    style={{ color: theme.textSubtle }}
                  >
                    Qualité de l&apos;air
                  </p>
                  <p
                    className="text-[13px] font-black mt-0.5"
                    style={{ color: STATUS_MAP[selectedStation.status].color }}
                  >
                    {formatAirQualityValue(getAirQualityValue(selectedStation))}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsPanelOpen(true)}
                className="shrink-0 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                style={{
                  color: theme.textMuted,
                  border: `1px solid ${theme.panelBorder}`,
                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                }}
              >
                Analyser →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── DETAIL PANEL (right slide-in) ── */}
      <AnimatePresence>
        {isPanelOpen && selectedStation && (
          <motion.div
            initial={{ x: "110%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "110%", opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-4 right-4 bottom-4 w-90 z-30 rounded-3xl overflow-hidden"
            style={{
              background: isDark
                ? "linear-gradient(180deg, rgba(8,12,22,0.98) 0%, rgba(5,8,16,0.98) 100%)"
                : "linear-gradient(180deg, rgba(248,250,255,0.98) 0%, rgba(240,244,252,0.98) 100%)",
              border: `1px solid ${theme.panelBorder}`,
              boxShadow: isDark
                ? "-20px 0 60px rgba(0,0,0,0.6)"
                : "-8px 0 40px rgba(0,0,0,0.12)",
              backdropFilter: "blur(32px)",
            }}
          >
            <button
              onClick={() => setIsPanelOpen(false)}
              className="absolute top-5 right-5 w-8 h-8 rounded-xl flex items-center justify-center text-sm transition-all"
              style={{
                background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                border: `1px solid ${theme.panelBorder}`,
                color: theme.textMuted,
              }}
            >
              ✕
            </button>

            <div className="p-8 h-full overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    background: STATUS_MAP[selectedStation.status].color,
                    boxShadow: `0 0 10px ${STATUS_MAP[selectedStation.status].color}`,
                  }}
                />
                <span
                  className="text-[9px] font-black uppercase tracking-widest"
                  style={{ color: STATUS_MAP[selectedStation.status].color }}
                >
                  {STATUS_MAP[selectedStation.status].label}
                </span>
              </div>

              <h2 className="text-[26px] font-black leading-tight tracking-tight mb-1">
                {selectedStation.nom}
              </h2>
              <p
                className="text-[10px] font-bold uppercase tracking-[0.3em] mb-6"
                style={{ color: theme.textSubtle }}
              >
                ID #{selectedStation.id} · {fablab?.nom ?? "FabLab"}
              </p>

              <div
                className="h-px mb-6"
                style={{
                  background: `linear-gradient(90deg, ${STATUS_MAP[selectedStation.status].color}50, transparent)`,
                }}
              />

              {/* Description */}
              <div className="mb-6">
                <p
                  className="text-[9px] font-bold uppercase tracking-[0.3em] mb-2"
                  style={{ color: theme.textSubtle }}
                >
                  Diagnostic
                </p>
                <p
                  className="text-[12px] leading-relaxed"
                  style={{ color: theme.textMuted }}
                >
                  {selectedStation.desc}
                </p>
              </div>

              {/* Qualité de l'air */}
              <div className="mb-6">
                <p
                  className="text-[9px] font-bold uppercase tracking-[0.3em] mb-3"
                  style={{ color: theme.textSubtle }}
                >
                  Métrique capteur
                </p>
                {(() => {
                  const airQualityValue = getAirQualityValue(selectedStation);
                  const info = STATUS_MAP[selectedStation.status];
                  const normal = selectedStation.status === "stable";
                  return (
                    <div
                      className="rounded-xl p-4 text-center"
                      style={{
                        background: !normal
                          ? `${info.color}14`
                          : isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)",
                        border: !normal
                          ? `1px solid ${info.color}33`
                          : `1px solid ${theme.panelBorder}`,
                      }}
                    >
                      <p
                        className="text-[8px] font-bold uppercase tracking-wider mb-1.5"
                        style={{ color: theme.textSubtle }}
                      >
                        Qualité de l&apos;air
                      </p>
                      <p
                        className={`${airQualityValue === null ? "text-[14px]" : "text-[22px]"} font-black`}
                        style={{ color: normal ? theme.text : info.color }}
                      >
                        {formatAirQualityValue(airQualityValue)}
                      </p>
                      {!normal && (
                        <p
                          className="text-[8px] font-bold uppercase tracking-wider mt-1"
                          style={{ color: info.color }}
                        >
                          {info.label}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Seuils reference */}
              <div className="mb-6">
                <p
                  className="text-[9px] font-bold uppercase tracking-[0.3em] mb-2"
                  style={{ color: theme.textSubtle }}
                >
                  Seuils de référence
                </p>
                <div
                  className="rounded-xl p-3 font-mono text-[10px]"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.03)",
                    border: `1px solid ${theme.panelBorder}`,
                    color: theme.textMuted,
                  }}
                >
                  {[
                    ["Optimal", `< ${THRESHOLDS.mediumMin}`],
                    ["Moyen", `${THRESHOLDS.mediumMin}–${THRESHOLDS.mediumMax}`],
                    ["Alerte", `${THRESHOLDS.alerteMin}–${THRESHOLDS.alerteMax}`],
                    ["Danger", `≥ ${THRESHOLDS.dangerMin}`],
                    ["Hors ligne", "> 10s sans activité"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-0.5">
                      <span>{k}</span>
                      <span
                        style={{
                          color:
                            k === "Danger"
                              ? "#ef4444"
                              : k === "Alerte"
                              ? "#f97316"
                              : k === "Moyen"
                              ? "#eab308"
                              : k === "Hors ligne"
                              ? "#64748b"
                              : theme.textMuted,
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <button
                  className="py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-white transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${STATUS_MAP[selectedStation.status].color}cc, ${STATUS_MAP[selectedStation.status].color}88)`,
                    boxShadow: `0 4px 20px ${STATUS_MAP[selectedStation.status].color}30`,
                  }}
                >
                  {selectedStation.status === "critical"
                    ? "Action zone Danger"
                    : selectedStation.status === "warning"
                    ? "Contrôle zone Alerte"
                    : selectedStation.status === "medium"
                    ? "Surveillance zone Moyen"
                    : selectedStation.status === "offline"
                    ? "Station hors ligne"
                    : "Générer rapport"}
                </button>
                <button
                  onClick={() => setIsPanelOpen(false)}
                  className="py-2.5 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-colors"
                  style={{
                    color: theme.textSubtle,
                    border: `1px solid ${theme.panelBorder}`,
                  }}
                >
                  Fermer
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAdminPanelOpen && monitorRole === "admin" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/55 backdrop-blur-sm"
            onClick={() => setIsAdminPanelOpen(false)}
          >
            <motion.div
              initial={{ x: "105%" }}
              animate={{ x: 0 }}
              exit={{ x: "105%" }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-4 top-4 bottom-4 w-[min(940px,calc(100vw-2rem))] rounded-3xl overflow-hidden"
              style={glassPanelStyle}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-4 border-b px-6 py-5" style={{ borderColor: theme.panelBorder }}>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: theme.textSubtle }}>Administration</p>
                  <h2 className="text-lg font-black">Logs FabLabs et roles</h2>
                </div>
                <button
                  onClick={() => setIsAdminPanelOpen(false)}
                  className="h-8 w-8 rounded-xl text-sm"
                  style={{ color: theme.textMuted, border: `1px solid ${theme.panelBorder}` }}
                >
                  x
                </button>
              </div>

              <div className="grid h-[calc(100%-73px)] grid-cols-1 lg:grid-cols-2 overflow-hidden">
                <div className="overflow-y-auto border-r p-5" style={{ borderColor: theme.panelBorder }}>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-black">Membres</h3>
                    <button onClick={loadAdminPanel} className="rounded-lg px-3 py-1.5 text-[10px] font-bold" style={{ border: `1px solid ${theme.panelBorder}`, color: theme.textMuted }}>
                      Actualiser
                    </button>
                  </div>
                  {adminLoading ? (
                    <p className="text-xs" style={{ color: theme.textMuted }}>Chargement...</p>
                  ) : (
                    <div className="space-y-2">
                      {adminMembers.map((member) => {
                        const name = `${member.prenom ?? ""} ${member.nom ?? ""}`.trim() || member.email || member.id;
                        return (
                          <div key={member.id} className="rounded-2xl p-3" style={{ background: isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.04)", border: `1px solid ${theme.panelBorder}` }}>
                            <div className="mb-3">
                              <p className="text-xs font-bold truncate">{name}</p>
                              <p className="text-[10px] truncate" style={{ color: theme.textMuted }}>{member.email}</p>
                              <p className="mt-1 text-[9px] font-mono uppercase tracking-widest" style={{ color: theme.textSubtle }}>
                                {member.fablab_ref ? `FabLab ${member.fablab_ref}` : "FabLab non associe"}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {ADMIN_ROLE_OPTIONS.map((option) => {
                                const active = member.role === option.value;
                                return (
                                  <button
                                    key={option.value}
                                    onClick={() => updateMemberRole(member.id, option.value)}
                                    className="rounded-lg px-3 py-1.5 text-[10px] font-black uppercase"
                                    style={{
                                      background: active ? `${option.color}26` : "transparent",
                                      border: `1px solid ${option.color}55`,
                                      color: option.color,
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="overflow-y-auto p-5">
                  <h3 className="mb-4 text-sm font-black">Logs tous FabLabs</h3>
                  <div className="space-y-2">
                    {adminLogs.map((log) => (
                      <div key={log.id} className="rounded-2xl p-3" style={{ background: isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.04)", border: `1px solid ${theme.panelBorder}` }}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold">{log.action}</p>
                          <span className="text-[9px] font-mono" style={{ color: theme.textSubtle }}>
                            {new Date(log.created_at).toLocaleString("fr-FR")}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px]" style={{ color: theme.textMuted }}>
                          Role {log.actor_role ?? "system"} - FabLab {log.fablab_id ?? "global"}
                        </p>
                        <pre className="mt-2 max-h-20 overflow-auto rounded-lg p-2 text-[9px]" style={{ background: isDark ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.5)", color: theme.textMuted }}>
                          {JSON.stringify(log.details ?? {}, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── HINT ── */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.5, duration: 1 }}
        className="absolute bottom-5 right-5 z-10 text-[8px] font-mono uppercase tracking-widest pointer-events-none"
        style={{ color: theme.textSubtle }}
      >
        Cliquer · Orbiter · Zoomer
      </motion.p>
    </div>
  );
}
