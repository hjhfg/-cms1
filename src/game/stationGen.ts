import divisionsRaw from '../data/divisions.json';
import { CITY_META } from '../data/cities';
import { isLand, project } from './geo';
import type { Shape, StationDef } from '../data/regions';

interface Div {
  n: string; // 区县名
  x: number;
  y: number; // lon, lat
  r: number; // 近似半径 km
  t: string[]; // 乡镇 / 街道（已去后缀）
}

const DIVISIONS = divisionsRaw as unknown as Record<string, Div[]>;

const BASE_SHAPES: Shape[] = ['circle', 'triangle', 'square', 'diamond', 'pentagon', 'cross'];

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COUNTY_SUFFIX = /(特别行政区|自治县|自治旗|自治州|林区|新区|矿区|市辖区|区|县|市|旗)$/;
export function shortCounty(n: string) {
  const s = n.replace(COUNTY_SUFFIX, '');
  return s || n;
}

/** 在区县内取一个落在陆地上的点 */
function jitterPoint(div: Div, rnd: () => number, spread: number): [number, number] {
  const maxR = Math.min(div.r * spread, 30);
  for (let k = 0; k < 10; k++) {
    const ang = rnd() * Math.PI * 2;
    const rad = Math.sqrt(rnd()) * maxR;
    const lat = div.y + (Math.sin(ang) * rad) / 111;
    const lon = div.x + (Math.cos(ang) * rad) / (111 * Math.max(0.2, Math.cos((div.y * Math.PI) / 180)));
    const [x, z] = project(lon, lat);
    if (isLand(x, z)) return [lon, lat];
  }
  return [div.x, div.y];
}

/**
 * 程序化生成一座城市的车站：区县 → 1 站，城市越密/越大站越多，
 * 站点名用真实的“区 / 镇街”，每次开局排布与命名组合都不同。
 */
export function generateStations(seed: number, cityId: string): StationDef[] {
  const meta = CITY_META.find((c) => c.id === cityId)!;
  const divs = (DIVISIONS[cityId] ?? []).slice();
  const rnd = mulberry32(seed);
  if (!divs.length) {
    return [{ name: meta.short, lon: meta.lon, lat: meta.lat, tier: 3, shape: 'star' }];
  }

  const out: StationDef[] = [];
  const used = new Set<string>();
  const placed: [number, number][] = [];
  const push = (name: string, lon: number, lat: number, tier: 1 | 2 | 3, shape: Shape) => {
    if (used.has(name)) return;
    used.add(name);
    placed.push([lon, lat]);
    out.push({ name, lon, lat, tier, shape });
  };

  // 主枢纽：面积最小（最城市化）的区县；缺乡镇数据时退回区县名
  const bySize = divs.slice().sort((a, b) => a.r - b.r);
  const hub = bySize[0];
  const hubTown = hub.t.length ? hub.t[Math.floor(rnd() * Math.min(hub.t.length, 6))] : '';
  const hubName = hubTown ? `${meta.short}·${hubTown}` : shortCounty(hub.n);
  const [hx, hy] = jitterPoint(hub, rnd, 0.35);
  push(hubName, hx, hy, 3, 'star');

  const extra = Math.min(4, Math.round(meta.area / 12000));
  const target = Math.max(4, Math.min(17, divs.length + 2 + extra));

  // 每个区县一镇
  for (const d of divs) {
    if (out.length >= target) break;
    if (d.n === hub.n) continue; // 主枢纽已代表该区
    const short = shortCounty(d.n);
    const [lon, lat] = jitterPoint(d, rnd, 0.6);
    const tier: 1 | 2 = d.r < 13 ? 2 : 1;
    push(short, lon, lat, tier, BASE_SHAPES[(out.length * 5 + 3) % 6]);
  }

  // 余下名额：给乡镇最多的区县追加“区·镇”站
  const dense = divs.slice().sort((a, b) => b.t.length - a.t.length);
  let guard = 0;
  while (out.length < target && guard++ < 40) {
    const d = dense[guard % dense.length];
    const short = shortCounty(d.n);
    const town = d.t[Math.floor(rnd() * d.t.length)];
    if (!town) continue;
    const [lon, lat] = jitterPoint(d, rnd, 0.45);
    const name = town === short ? `${short}新城` : `${short}·${town}`;
    if (used.has(name)) continue;
    // 与已有站保持一点距离
    if (placed.some((p) => Math.hypot(p[0] - lon, p[1] - lat) * 105 < 5)) continue;
    push(name, lon, lat, 1, BASE_SHAPES[(out.length * 5 + 3) % 6]);
  }

  return out;
}

/** 一座城市的区县 / 乡镇清单（供 UI 展示） */
export function cityDivisions(cityId: string) {
  return DIVISIONS[cityId] ?? [];
}
