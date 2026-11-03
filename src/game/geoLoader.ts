import meta from '../data/provinces.json';
import { project } from './geo';

// ============================================================
//  全国地理数据流式加载器
//
//  设计参考十字军之王（CK3）的地图引擎：
//   1. 元数据先行 —— 省级索引 + 区县中心点（210 KB）随首屏加载，
//      立刻能画出城市点位和交互热点，无需等待几何。
//   2. 几何按需 —— 每省一个紧凑二进制，只 fetch 当前视野覆盖的省。
//   3. 渐进细化 —— 先有低模轮廓，高精度边界后到，画面不会空着。
//   4. ID 栅格 —— 用低分辨率像素存行政区 ID 做命中检测，
//      避免每帧遍历 3252 个多边形。
// ============================================================

export interface CountyMeta {
  n: string;                 // 区县名
  cp: [number, number] | null; // 中心点 [lon, lat]
  p: number;                 // 多边形数
  o: number;                 // 字节偏移
  l: number;                 // 字节长度
}

export interface ProvinceMeta {
  id: string;
  name: string;
  cities: number;
  counties: number;
  geo: string;
  bytes: number;
  index: CountyMeta[];
}

export interface ProvinceGeo {
  id: string;
  /// 每个区县的多边形（世界坐标 km）
  counties: { meta: CountyMeta; polys: [number, number][][][] }[];
}

export const GEO_META = meta as {
  version: number;
  quant: number;
  tol: number;
  provinces: ProvinceMeta[];
  stats: { provinces: number; cities: number; counties: number; rawPoints: number; points: number; geoBytes: number };
};

export const PROVINCES = GEO_META.provinces;
export const QUANT = GEO_META.quant;

const byId = new Map<string, ProvinceMeta>();
for (const p of PROVINCES) byId.set(p.id, p);

export function provinceMeta(id: string): ProvinceMeta | undefined {
  return byId.get(id);
}

// ---------- varint 解码 ----------
function readVarint(buf: Uint8Array, st: { p: number }): number {
  let n = 0;
  let shift = 0;
  for (;;) {
    const b = buf[st.p++];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return (n >>> 1) ^ -(n & 1); // zigzag 解码
}

function readU32(buf: Uint8Array, st: { p: number }): number {
  const v = buf[st.p] | (buf[st.p + 1] << 8) | (buf[st.p + 2] << 16) | (buf[st.p + 3] << 24);
  st.p += 4;
  return v >>> 0;
}

const Q2KM = 1 / QUANT;

/** 解码一段区县几何为世界坐标（km）多边形 */
function decodeCounty(buf: Uint8Array, start: number, len: number): [number, number][][][] {
  const end = start + len;
  const st = { p: start };
  const out: [number, number][][][] = [];
  let npoly = 0;
  while (st.p < end) {
    const nrings = readU32(buf, st);
    const rings: [number, number][][] = [];
    for (let r = 0; r < nrings; r++) {
      const npts = readU32(buf, st);
      const ring: [number, number][] = new Array(npts);
      let qx = 0;
      let qy = 0;
      for (let i = 0; i < npts; i++) {
        qx += readVarint(buf, st);
        qy += readVarint(buf, st);
        ring[i] = project(qx * Q2KM, qy * Q2KM);
      }
      rings.push(ring);
    }
    out.push(rings);
    npoly++;
    if (npoly > 20000) break; // 防御
  }
  return out;
}

// ---------- 加载与缓存 ----------
const cache = new Map<string, ProvinceGeo>();
const pending = new Map<string, Promise<ProvinceGeo>>();

/** 已加载的省份 */
export function loadedProvinces(): ProvinceGeo[] {
  return [...cache.values()];
}

export function isLoaded(id: string): boolean {
  return cache.has(id);
}

/** 加载一个省的几何（带缓存与去重） */
export function loadProvince(id: string): Promise<ProvinceGeo> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  const run = pending.get(id);
  if (run) return run;

  const m = byId.get(id);
  if (!m) return Promise.reject(new Error('未知省份 ' + id));

  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const url = `${base}geo/${m.geo}`.replace(/\/{2,}/g, '/');

  const pr = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`加载 ${m.geo} 失败 ${r.status}`);
      return r.arrayBuffer();
    })
    .then((ab) => {
      const buf = new Uint8Array(ab);
      const counties = m.index.map((cm) => ({
        meta: cm,
        polys: decodeCounty(buf, cm.o, cm.l),
      }));
      const g: ProvinceGeo = { id, counties };
      cache.set(id, g);
      pending.delete(id);
      return g;
    })
    .catch((e) => {
      pending.delete(id);
      throw e;
    });

  pending.set(id, pr);
  return pr;
}

/** 释放某省几何，控制显存/内存 */
export function unloadProvince(id: string) {
  cache.delete(id);
}

/** 某省的世界坐标包围盒（用于视野判定） */
const bboxCache = new Map<string, { minX: number; minZ: number; maxX: number; maxZ: number }>();

export function provinceBBox(id: string) {
  const hit = bboxCache.get(id);
  if (hit) return hit;
  const m = byId.get(id);
  if (!m) return null;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const cm of m.index) {
    if (!cm.cp) continue;
    const [x, z] = project(cm.cp[0], cm.cp[1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (minX > maxX) return null;
  // 中心点包围盒会小于实际省界，外扩 12%
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const hw = (maxX - minX) * 0.62 + 60;
  const hh = (maxZ - minZ) * 0.62 + 60;
  const bb = { minX: cx - hw, maxX: cx + hw, minZ: cz - hh, maxZ: cz + hh };
  bboxCache.set(id, bb);
  return bb;
}

/** 视野需要哪些省（按包围盒相交） */
export function provincesInView(minX: number, minZ: number, maxX: number, maxZ: number): string[] {
  const out: string[] = [];
  for (const p of PROVINCES) {
    const bb = provinceBBox(p.id);
    if (!bb) continue;
    if (bb.maxX < minX || bb.minX > maxX || bb.maxZ < minZ || bb.minZ > maxZ) continue;
    out.push(p.id);
  }
  return out;
}
