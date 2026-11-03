import map from '../data/map.json';
import { RIVERS } from '../data/rivers';
import { DELTA_RIVERS } from '../data/delta';
import { LAKES } from '../data/lakes';

// 正弦投影：1 单位 = 1 公里（真实 1:1 比例）
export const R_EARTH = 6371.0088;
export const LON0 = 107.5;
export const LAT0 = 24.5;
const D2R = Math.PI / 180;

export function project(lon: number, lat: number): [number, number] {
  const phi = lat * D2R;
  const x = R_EARTH * (lon - LON0) * D2R * Math.cos(phi);
  const z = -R_EARTH * (lat - LAT0) * D2R;
  return [x, z];
}

export interface RegionGeo {
  id: string;
  name: string;
  polys: [number, number][][][]; // polys -> rings -> [x,z] km
}

export const REGIONS: RegionGeo[] = (map as unknown as { id: string; name: string; polys: number[][][][] }[]).map((f) => ({
  id: f.id,
  name: f.name,
  polys: f.polys.map((poly) => poly.map((ring) => ring.map((p) => project(p[0], p[1])))),
}));

export const BOUNDS = (() => {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const r of REGIONS) for (const poly of r.polys) for (const ring of poly) for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX: minX - 10, maxX: maxX + 10, minZ: minZ - 10, maxZ: maxZ + 10 };
})();

// ---------- 陆地掩码（跨海造价、建筑摆放、点击城市判定） ----------
const PX_PER_KM = 1.25;
let maskData: ImageData | null = null;
let maskW = 0;
let maskH = 0;

const NO_DOM = typeof document === 'undefined';

function ensureMask() {
  if (maskData) return;
  if (NO_DOM) {
    maskW = 1;
    maskH = 1;
    maskData = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData;
    return;
  }
  maskW = Math.ceil((BOUNDS.maxX - BOUNDS.minX) * PX_PER_KM);
  maskH = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) * PX_PER_KM);
  const c = document.createElement('canvas');
  c.width = maskW;
  c.height = maskH;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, maskW, maskH);
  REGIONS.forEach((r, i) => {
    g.fillStyle = `rgb(${i + 1},0,0)`;
    for (const poly of r.polys) {
      g.beginPath();
      for (const ring of poly) {
        ring.forEach(([x, z], k) => {
          const px = (x - BOUNDS.minX) * PX_PER_KM;
          const py = (z - BOUNDS.minZ) * PX_PER_KM;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
        g.closePath();
      }
      g.fill('evenodd');
    }
  });
  maskData = g.getImageData(0, 0, maskW, maskH);
}

// 无 DOM（Node 回归测试 / 模拟脚本）时用纯几何判定，逻辑与掩膜一致
const REGION_BOX = REGIONS.map((r) => {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const poly of r.polys) for (const p of poly[0]) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { r, minX, maxX, minZ, maxZ };
});

function pointInRing(x: number, z: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function lakeAt(x: number, z: number): ProjectedLake | null {
  for (const l of PROJECTED_LAKES) {
    if (x < l.minX || x > l.maxX || z < l.minZ || z > l.maxZ) continue;
    if (pointInRing(x, z, l.pts)) return l;
  }
  return null;
}

const nearCache = new Map<number, boolean>();
const NEAR_STEP = 0.5;
/** 附近 r 公里内是否有陆地（用来区分“狭窄潮汐河道”和“开阔海面”） */
export function nearLand(x: number, z: number, r: number): boolean {
  const key = Math.round(x / NEAR_STEP) * 100003 + Math.round(z / NEAR_STEP) * 7 + Math.round(r * 10);
  const hit = nearCache.get(key);
  if (hit !== undefined) return hit;
  let res = false;
  const dr = Math.max(0.35, r / 4);
  for (let rad = dr; rad <= r + 1e-6 && !res; rad += dr) {
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      if (isLand(x + Math.cos(a) * rad, z + Math.sin(a) * rad)) {
        res = true;
        break;
      }
    }
  }
  if (nearCache.size > 400000) nearCache.clear();
  nearCache.set(key, res);
  return res;
}

/** 是否落在水面（海 / 江 / 河 / 湖）——用于岸堤避让 */
export function isWater(x: number, z: number): boolean {
  if (!isLand(x, z)) return true;
  return !!riverAt(x, z) || !!lakeAt(x, z);
}

function isLandMath(x: number, z: number) {
  for (const b of REGION_BOX) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    for (const poly of b.r.polys) {
      if (!pointInRing(x, z, poly[0])) continue;
      let hole = false;
      for (let i = 1; i < poly.length; i++) if (pointInRing(x, z, poly[i])) hole = true;
      if (!hole) return true;
    }
  }
  return false;
}

export function isLand(x: number, z: number): boolean {
  if (NO_DOM) return isLandMath(x, z);
  ensureMask();
  const px = Math.floor((x - BOUNDS.minX) * PX_PER_KM);
  const py = Math.floor((z - BOUNDS.minZ) * PX_PER_KM);
  if (px < 0 || py < 0 || px >= maskW || py >= maskH) return false;
  return maskData!.data[(py * maskW + px) * 4 + 3] > 140;
}

export function regionAt(x: number, z: number): string | null {
  ensureMask();
  const px = Math.floor((x - BOUNDS.minX) * PX_PER_KM);
  const py = Math.floor((z - BOUNDS.minZ) * PX_PER_KM);
  if (px < 0 || py < 0 || px >= maskW || py >= maskH) return null;
  const o = (py * maskW + px) * 4;
  if (maskData!.data[o + 3] < 140) return null;
  const idx = maskData!.data[o];
  return REGIONS[idx - 1]?.id ?? null;
}

export function seaKm(ax: number, az: number, bx: number, bz: number): number {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.ceil(len / 0.8));
  let sea = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!isLand(ax + (bx - ax) * t, az + (bz - az) * t)) sea++;
  }
  return (sea / (n + 1)) * len;
}

// ---------- 河流 ----------
export interface ProjectedRiver {
  name: string;
  cls: 1 | 2;
  w: number;
  pts: [number, number][];
}

export const PROJECTED_RIVERS: ProjectedRiver[] = [...RIVERS, ...DELTA_RIVERS].map((r) => ({
  name: r.name,
  cls: r.cls,
  w: r.w,
  pts: r.pts.map(([lon, lat]) => project(lon, lat)),
}));

// 河段空间索引（20km 网格），避免逐段扫描
const RIVER_CELL = 20;
const riverGrid = new Map<string, { a: [number, number]; b: [number, number]; r: ProjectedRiver; half: number }[]>();
(function buildRiverGrid() {
  for (const r of PROJECTED_RIVERS) {
    r.pts.forEach((a, i) => {
      if (i === 0) return;
      const b = r.pts[i - 1];
      const half = Math.max(0.25, r.w * 0.5);
      const x0 = Math.min(a[0], b[0]) - half;
      const x1 = Math.max(a[0], b[0]) + half;
      const z0 = Math.min(a[1], b[1]) - half;
      const z1 = Math.max(a[1], b[1]) + half;
      for (let cx = Math.floor(x0 / RIVER_CELL); cx <= Math.floor(x1 / RIVER_CELL); cx++) {
        for (let cz = Math.floor(z0 / RIVER_CELL); cz <= Math.floor(z1 / RIVER_CELL); cz++) {
          const k = `${cx},${cz}`;
          const arr = riverGrid.get(k) ?? [];
          arr.push({ a, b, r, half });
          riverGrid.set(k, arr);
        }
      }
    });
  }
})();

function distToSeg(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}

/** 该点是否落在某条江/河的水面上 */
export function riverAt(x: number, z: number): ProjectedRiver | null {
  const cx = Math.floor(x / RIVER_CELL);
  const cz = Math.floor(z / RIVER_CELL);
  let best: ProjectedRiver | null = null;
  let bestD = Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const arr = riverGrid.get(`${cx + i},${cz + j}`);
      if (!arr) continue;
      for (const s of arr) {
        const d = distToSeg(x, z, s.a, s.b);
        if (d <= s.half && d < bestD) {
          bestD = d;
          best = s.r;
        }
      }
    }
  }
  return best;
}

// ---------- 湖泊 ----------------
export interface ProjectedLake {
  name: string;
  pts: [number, number][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const PROJECTED_LAKES: ProjectedLake[] = LAKES.map((l) => {
  const pts = l.pts.map(([lon, lat]) => project(lon, lat)) as [number, number][];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { name: l.name, pts, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
});

export type WaterKind = 'none' | 'river' | 'jiang' | 'lake' | 'sea';

export interface WaterProfile {
  river: number; // km
  jiang: number; // km
  lake: number; // km
  sea: number; // km
  from: number; // 首个水面采样点的比例位置
  to: number; // 最后一个水面采样点的比例位置
  kind: WaterKind; // 主要跨水域（用于桥型）
}

/** 沿线段采样，统计水域里程与跨度（用于造价与桥型） */
export function waterProfile(ax: number, az: number, bx: number, bz: number): WaterProfile {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(4, Math.ceil(len / 0.7));
  let river = 0;
  let jiang = 0;
  let lake = 0;
  let sea = 0;
  let from = 1;
  let to = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    let kind: WaterKind = 'none';
    if (!isLand(x, z)) kind = 'sea';
    else if (lakeAt(x, z)) kind = 'lake';
    else {
      const r = riverAt(x, z);
      if (r) kind = r.cls === 2 ? 'jiang' : 'river';
    }
    if (kind === 'none') continue;
    const seg = len / n;
    if (kind === 'river') river += seg;
    else if (kind === 'jiang') jiang += seg;
    else if (kind === 'lake') lake += seg;
    else sea += seg;
    if (t < from) from = t;
    if (t > to) to = t;
  }
  if (to < from) {
    from = 0;
    to = 0;
  }
  const best = Math.max(sea, lake, jiang, river);
  const kind: WaterKind = best <= 0 ? 'none' : sea === best ? 'sea' : lake === best ? 'lake' : jiang === best ? 'jiang' : 'river';
  return { river, jiang, lake, sea, from, to, kind };
}

export function landingPoint(x0: number, z0: number, x1: number, z1: number): [number, number] {
  // 从 (x0,z0) 向 (x1,z1) 找到第一个陆地采样点（用于桥头位置）
  const n = 64;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    if (isLand(x, z)) return [x, z];
  }
  return [x1, z1];
}
