import gd from '../data/gd.json';

// 正弦投影：1 单位 = 1 公里（真实 1:1 比例）
export const R_EARTH = 6371.0088;
export const LON0 = 113.5;
export const LAT0 = 22.9;
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

export const REGIONS: RegionGeo[] = (gd as unknown as { id: string; name: string; polys: number[][][][] }[]).map((f) => ({
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

// ---------- 陆地掩码（用于海底隧道造价、建筑摆放、点击城市判定） ----------
const PX_PER_KM = 2;
let maskData: ImageData | null = null;
let maskW = 0;
let maskH = 0;

function ensureMask() {
  if (maskData) return;
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

export function isLand(x: number, z: number): boolean {
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
