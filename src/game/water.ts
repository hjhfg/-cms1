import * as THREE from 'three';
import { PROJECTED_LAKES, PROJECTED_RIVERS, isLand, isWater, lakeAt, nearLand } from './geo';

// 水面高度：略高于陆地顶面（陆地顶面 y=0），避免 z-fighting
export const WATER_Y = 0.0012;
// 堤岸顶（珠三角的“基围”：河床两侧抬起的堤）
const BANK_Y = 0.0034;
// 每条河/湖再抬升极小的高度，交叉处不会 z-fighting（差值远小于视觉精度）
const LEVEL_EPS = 2e-6;
const STEP = 0.7; // 中心线采样间距 km

type P2 = [number, number];

/** 向心 Catmull-Rom：把手绘折线变成顺滑河道 */
export function smoothLine(pts: P2[], step = STEP): P2[] {
  if (pts.length < 3) return resampleLinear(pts, step);
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  const out: P2[] = [];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) out.push(cr(p0, p1, p2, p3, k / n));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function resampleLinear(pts: P2[], step: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function cr(p0: P2, p1: P2, p2: P2, p3: P2, t: number): P2 {
  const d = (a: P2, b: P2) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const mix = (a: P2, b: P2, ta: number, tb: number): P2 => {
    const u = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

export interface GeoBuf {
  pos: number[];
  col: number[];
  idx: number[];
  uv: number[];
}

const emptyBuf = (): GeoBuf => ({ pos: [], col: [], idx: [], uv: [] });

function tubeNormals(line: P2[]): P2[] {
  return line.map((_, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    return [-dz, dx] as P2;
  });
}

type Quad = { p: [number, number, number][]; c: [number, number, number][]; uv?: [number, number][] };

function pushQuad(buf: GeoBuf, quad: Quad) {
  const base = buf.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    buf.pos.push(quad.p[i][0], quad.p[i][1], quad.p[i][2]);
    buf.col.push(quad.c[i][0], quad.c[i][1], quad.c[i][2]);
    buf.uv.push(...(quad.uv ? quad.uv[i] : [0, 0]));
  }
  buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
}

const SHALLOW: [number, number, number] = [0.22, 0.52, 0.53];
// 河面进入潮汐河道/河口时改用海面同色，避免深色水带压在海面上
const BLEND: [number, number, number] = [0.075, 0.416, 0.56];
const MID: [number, number, number] = [0.1, 0.33, 0.41];
const DEEP: [number, number, number] = [0.05, 0.2, 0.29];

/** 河道水面：横截面 5 个顶点做“浅滩→深槽”渐变，视觉上就有水深 */
export function riverWater(line: P2[], width: number, y = WATER_Y): GeoBuf {
  const buf = emptyBuf();
  const n = tubeNormals(line);
  const half = width / 2;
  const xs = [-1, -0.55, 0, 0.55, 1];
  const cs = [SHALLOW, MID, DEEP, MID, SHALLOW];
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  for (let i = 1; i < line.length; i++) {
    for (let k = 0; k < xs.length - 1; k++) {
      const q: Quad = { p: [], c: [], uv: [] };
      for (const [di, ki] of [[i - 1, k], [i - 1, k + 1], [i, k], [i, k + 1]] as const) {
        const p = line[di];
        const nn = n[di];
        q.p.push([p[0] + nn[0] * half * xs[ki], y, p[1] + nn[1] * half * xs[ki]]);
        q.c.push(cs[ki]);
        q.uv!.push([ki / 4, cum[di] / 7]);
      }
      // 河道穿过湖面时交给湖；进入开阔海面（离岸 > 6 km）时收住，避免深色水带压在海面上。
      // 6 km 的阈值保证珠三角这种潮汐河道不会断成虚线
      const cx = (q.p[0][0] + q.p[3][0]) / 2;
      const cz = (q.p[0][2] + q.p[3][2]) / 2;
      if (lakeAt(cx, cz)) continue;
      if (!isLand(cx, cz)) {
        if (!nearLand(cx, cz, 6)) continue;
        // 水面之上：改成海面同色，跟海自然融合
        for (let k = 0; k < 4; k++) q.c[k] = BLEND;
      }
      pushQuad(buf, q);
    }
  }
  return buf;
}

/** 河堤：两侧从水面向外抬起的斜堤（真实珠三角基围） */
export function riverBanks(line: P2[], width: number, y = WATER_Y, top = BANK_Y): GeoBuf {
  const buf = emptyBuf();
  const n = tubeNormals(line);
  const half = width / 2;
  const inner: [number, number, number] = [0.34, 0.35, 0.27];
  const outer: [number, number, number] = [0.45, 0.47, 0.34];
  for (const side of [-1, 1]) {
    for (let i = 1; i < line.length; i++) {
      for (const [pa, pb] of [
        [i - 1, i],
      ] as const) {
        const A = line[pa];
        const B = line[pb];
        const nA = n[pa];
        const nB = n[pb];
        // 内缘（水面边）→ 外缘（堤顶）
        const a0: [number, number, number] = [A[0] + nA[0] * half * side, y, A[1] + nA[1] * half * side];
        const b0: [number, number, number] = [B[0] + nB[0] * half * side, y, B[1] + nB[1] * half * side];
        const a1: [number, number, number] = [A[0] + nA[0] * half * 1.3 * side, top, A[1] + nA[1] * half * 1.3 * side];
        const b1: [number, number, number] = [B[0] + nB[0] * half * 1.3 * side, top, B[1] + nB[1] * half * 1.3 * side];
        // 外缘落在别的河道/海里就跳过，避免河堤压在水面上
        // 外缘落在开阔海面/湖面就跳过；狭窄潮汐河道两侧仍要画堤
        if ((isWater(a1[0], a1[2]) || isWater(b1[0], b1[2])) && !nearLand((a1[0] + b1[0]) / 2, (a1[2] + b1[2]) / 2, 2.2)) continue;
        if (isWater((a0[0] + a1[0]) / 2, (a0[2] + a1[2]) / 2) && !nearLand((a0[0] + a1[0]) / 2, (a0[2] + a1[2]) / 2, 1.6)) continue;
        pushQuad(buf, { p: [a0, b0, a1, b1], c: [inner, inner, outer, outer] });
      }
    }
  }
  return buf;
}

/** 湖泊水面（多边形三角化 + 中心稍深） */
export function lakeWater(pts: P2[], y = WATER_Y): GeoBuf {
  const buf = emptyBuf();
  const vs = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris: number[][] = [];
  try {
    tris = THREE.ShapeUtils.triangulateShape(vs, []);
  } catch {
    tris = [];
  }
  for (const t of tris) {
    const base = buf.pos.length / 3;
    for (const vi of t) {
      const p = pts[vi];
      buf.pos.push(p[0], y, p[1]);
      buf.col.push(MID[0], MID[1], MID[2]);
      buf.uv.push(0, 0);
    }
    buf.idx.push(base, base + 1, base + 2);
  }
  return buf;
}

/** 湖岸堤 */
export function lakeBanks(pts: P2[], lift = 1.2, y = WATER_Y, top = BANK_Y): GeoBuf {
  const buf = emptyBuf();
  const inner: [number, number, number] = [0.34, 0.35, 0.27];
  const outer: [number, number, number] = [0.45, 0.47, 0.34];
  const n = pts.length;
  // 判断环向
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  let sgn = area > 0 ? 1 : -1;
  // 用一条边试探：+法线仍在湖里，说明方向反了
  {
    const a = pts[0];
    const b = pts[1 % n];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    if (isWater(a[0] - dz * sgn * lift, a[1] + dx * sgn * lift)) sgn = -sgn;
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const nx = -dz * sgn;
    const nz = dx * sgn;
    // 外扩 0.9~1.6 km 的堤
    const a1: [number, number, number] = [a[0] + nx * lift, top, a[1] + nz * lift];
    const b1: [number, number, number] = [b[0] + nx * lift, top, b[1] + nz * lift];
    if (isWater(a1[0], a1[2]) && isWater(b1[0], b1[2])) continue;
    pushQuad(buf, {
      p: [
        [a[0], y, a[1]],
        [b[0], y, b[1]],
        a1,
        b1,
      ],
      c: [inner, inner, outer, outer],
    });
  }
  return buf;
}

export interface WaterBuild {
  water: GeoBuf;
  bank: GeoBuf;
  stats: { rivers: number; lakes: number; verts: number };
}

/** 构建全部河湖水面与堤岸 */
export function buildWater(step = STEP): WaterBuild {
  const water = emptyBuf();
  const bank = emptyBuf();
  let verts = 0;
  PROJECTED_RIVERS.forEach((r, ri) => {
    const lift = WATER_Y + ri * LEVEL_EPS * 2;
    const line = smoothLine(r.pts, step);
    const w = riverWater(line, r.w, lift);
    const b = riverBanks(line, r.w, lift, BANK_Y + ri * LEVEL_EPS * 2);
    for (const src of [w]) {
      const base = water.pos.length / 3;
      water.pos.push(...src.pos);
      water.col.push(...src.col);
      water.uv.push(...src.uv);
      for (const i of src.idx) water.idx.push(base + i);
      verts += src.pos.length / 3;
    }
    const bb = bank.pos.length / 3;
    bank.pos.push(...b.pos);
    bank.col.push(...b.col);
    bank.uv.push(...b.uv);
    for (const i of b.idx) bank.idx.push(bb + i);
  });
  PROJECTED_LAKES.forEach((l, li) => {
    const lift = WATER_Y + (PROJECTED_RIVERS.length + li) * LEVEL_EPS * 2;
    const w = lakeWater(l.pts, lift);
    const base = water.pos.length / 3;
    water.pos.push(...w.pos);
    water.col.push(...w.col);
    water.uv.push(...w.uv);
    for (const i of w.idx) water.idx.push(base + i);
    const b = lakeBanks(l.pts, 1.2, lift, BANK_Y + (PROJECTED_RIVERS.length + li) * LEVEL_EPS * 2);
    const bb = bank.pos.length / 3;
    bank.pos.push(...b.pos);
    bank.col.push(...b.col);
    bank.uv.push(...b.uv);
    for (const i of b.idx) bank.idx.push(bb + i);
  });
  return { water, bank, stats: { rivers: PROJECTED_RIVERS.length, lakes: PROJECTED_LAKES.length, verts } };
}

export function toGeometry(buf: GeoBuf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  g.setIndex(buf.idx);
  g.computeVertexNormals();
  return g;
}
