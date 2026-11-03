import { PROVINCES, QUANT, type ProvinceMeta } from './geoLoader';
import { project, unproject, R_EARTH, LON0, LAT0 } from './project';

// 投影实现见 project.ts（独立模块，避免循环依赖）
export { project, unproject, R_EARTH, LON0, LAT0 };

export interface RegionGeo {
  id: string;
  name: string;
  polys: [number, number][][][]; // polys -> rings -> [x,z] km
  center: [number, number];
  size: number;
}

// ---------- 省级「骨架」：只用区县中心点，不需几何即可构建 ----------
// 这是流式加载的关键：首屏就能画出省界轮廓和城市点位，
// 高精度几何后续按需补齐。
function buildSkeleton(m: ProvinceMeta): RegionGeo {
  const pts: [number, number][] = [];
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const c of m.index) {
    if (!c.cp) continue;
    const p = project(c.cp[0], c.cp[1]);
    pts.push(p);
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const cx = pts.length ? (minX + maxX) / 2 : 0;
  const cz = pts.length ? (minZ + maxZ) / 2 : 0;
  const size = pts.length ? Math.max(maxX - minX, maxZ - minZ) : 100;
  return {
    id: m.id,
    name: m.name,
    polys: [],
    center: [cx, cz],
    size,
  };
}

export const REGIONS: RegionGeo[] = PROVINCES.map(buildSkeleton);

export const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

export function regionById(id: string): RegionGeo | undefined {
  return REGION_BY_ID.get(id);
}

export const BOUNDS = (() => {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of PROVINCES) {
    for (const c of p.index) {
      if (!c.cp) continue;
      const [x, z] = project(c.cp[0], c.cp[1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  const pad = 260; // 留出海岸线与海洋
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
})();

// ---------- 陆地掩码 ----------
// 全国范围很大（约 5000×5000 km），掩码分辨率必须权衡：
// 1 px = 2 km 时约 2600×2600 = 6.8 Mpx / 27 MB，勉强可接受。
const PX_PER_KM = 0.5;
let maskData: ImageData | null = null;
let maskW = 0;
let maskH = 0;
let maskReady = false;

export function maskStatus() {
  return { w: maskW, h: maskH, ready: maskReady, pxPerKm: PX_PER_KM };
}

/** 用已加载的省级几何构建陆地掩码；未加载的省不参与 */
export function buildMask(regions: RegionGeo[]) {
  maskW = Math.ceil((BOUNDS.maxX - BOUNDS.minX) * PX_PER_KM);
  maskH = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) * PX_PER_KM);
  const c = document.createElement('canvas');
  c.width = maskW;
  c.height = maskH;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, maskW, maskH);
  regions.forEach((r, i) => {
    if (!r.polys.length) return;
    g.fillStyle = `rgb(${(i % 250) + 1},${Math.floor(i / 250) + 1},0)`;
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
  maskReady = true;
}

export function isLand(x: number, z: number): boolean {
  if (!maskData) return false;
  const px = Math.floor((x - BOUNDS.minX) * PX_PER_KM);
  const py = Math.floor((z - BOUNDS.minZ) * PX_PER_KM);
  if (px < 0 || py < 0 || px >= maskW || py >= maskH) return false;
  return maskData.data[(py * maskW + px) * 4 + 3] > 140;
}

export function regionAt(x: number, z: number): string | null {
  if (!maskData) return null;
  const px = Math.floor((x - BOUNDS.minX) * PX_PER_KM);
  const py = Math.floor((z - BOUNDS.minZ) * PX_PER_KM);
  if (px < 0 || py < 0 || px >= maskW || py >= maskH) return null;
  const o = (py * maskW + px) * 4;
  if (maskData.data[o + 3] < 140) return null;
  const idx = maskData.data[o] - 1 + (maskData.data[o + 1] - 1) * 250;
  return REGIONS[idx]?.id ?? null;
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

export { QUANT };
