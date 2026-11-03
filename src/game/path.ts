export interface PathData {
  n: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  cum: Float32Array;
  lane: Float32Array;
  stationS: number[]; // 站点沿线距离(km)
  length: number;
  version: number;
}

export interface PathArch {
  h: number; // 桥面拱高 km
  t0: number; // 水面区间起点（段内 0..1）
  t1: number;
}

export interface PathInput {
  pts: [number, number][]; // station x,z
  elev: number[]; // station track elevation (km)
  lanes: number[]; // lane value per segment (len = segs)
  loop: boolean;
  arch?: PathArch[]; // 每段跨水桥拱（len = segs）
}

const GROUND = 0.0004;
const ss = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

let VERSION = 1;

export function buildPath(inp: PathInput): PathData {
  const { pts, elev, lanes, loop, arch } = inp;
  const n = pts.length;
  const segs = loop ? n : n - 1;
  // tangents
  const dirs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let a: [number, number], b: [number, number];
    if (loop) {
      a = pts[(i - 1 + n) % n];
      b = pts[(i + 1) % n];
    } else {
      a = i === 0 ? pts[0] : pts[i - 1];
      b = i === n - 1 ? pts[n - 1] : pts[i + 1];
    }
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    dirs.push([dx, dz]);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const ln: number[] = [];
  const stationIdx: number[] = [];
  for (let i = 0; i < segs; i++) {
    const A = pts[i];
    const j = (i + 1) % n;
    const B = pts[j];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const k = len * 0.75;
    const m0 = dirs[i];
    const m1 = dirs[j];
    const cnt = Math.max(6, Math.min(2500, Math.ceil(len / 0.1)));
    const ramp = Math.min(2.5, len * 0.45);
    const ramp2 = Math.min(1.6, len * 0.3);
    stationIdx.push(xs.length);
    for (let s = 0; s < cnt; s++) {
      const t = s / cnt;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const x = h00 * A[0] + h10 * k * m0[0] + h01 * B[0] + h11 * k * m1[0];
      const z = h00 * A[1] + h10 * k * m0[1] + h01 * B[1] + h11 * k * m1[1];
      const dA = t * len;
      const dB = (1 - t) * len;
      const eA = elev[i];
      const eB = elev[j];
      let y = GROUND + (eA - GROUND) * (1 - ss(dA / ramp)) + (eB - GROUND) * (1 - ss(dB / ramp));
      const ar = arch?.[i];
      if (ar && ar.h > 0) {
        const span = Math.max(0.04, ar.t1 - ar.t0);
        const u = (t - ar.t0) / span;
        if (u > 0 && u < 1) y += ar.h * Math.sin(Math.PI * u);
      }
      xs.push(x);
      ys.push(y);
      zs.push(z);
      ln.push(lanes[i] * ss(Math.min(dA, dB) / ramp2));
    }
  }
  // final point
  const last = loop ? 0 : n - 1;
  stationIdx.push(xs.length);
  xs.push(pts[last][0]);
  ys.push(elev[last]);
  zs.push(pts[last][1]);
  ln.push(0);

  const N = xs.length;
  const px = new Float32Array(xs);
  const py = new Float32Array(ys);
  const pz = new Float32Array(zs);
  const cum = new Float32Array(N);
  for (let i = 1; i < N; i++) {
    cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
  }
  const stationS = stationIdx.map((i) => cum[i]);
  return { n: N, px, py, pz, cum, lane: new Float32Array(ln), stationS, length: cum[N - 1], version: VERSION++ };
}

export interface PathSample {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
}

export function pathAt(p: PathData, s0: number, out: PathSample): PathSample {
  const s = Math.max(0, Math.min(p.length, s0));
  const extra = s0 - s;
  let lo = 0;
  let hi = p.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = p.cum[hi] - p.cum[lo] || 1e-6;
  const t = (s - p.cum[lo]) / seg;
  out.x = p.px[lo] + (p.px[hi] - p.px[lo]) * t;
  out.y = p.py[lo] + (p.py[hi] - p.py[lo]) * t;
  out.z = p.pz[lo] + (p.pz[hi] - p.pz[lo]) * t;
  const dx = p.px[hi] - p.px[lo];
  const dz = p.pz[hi] - p.pz[lo];
  const l = Math.hypot(dx, dz) || 1;
  out.tx = dx / l;
  out.tz = dz / l;
  if (extra !== 0) {
    out.x += out.tx * extra;
    out.z += out.tz * extra;
  }
  return out;
}

// 最近的线路投影点：返回 [segmentIndex(station seg), distance]
export function nearestOnPath(p: PathData, x: number, z: number): { s: number; d: number } {
  let best = 1e18;
  let bs = 0;
  const step = Math.max(1, Math.floor(p.n / 4000));
  for (let i = 0; i < p.n; i += step) {
    const dx = p.px[i] - x;
    const dz = p.pz[i] - z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      bs = p.cum[i];
    }
  }
  return { s: bs, d: Math.sqrt(best) };
}
