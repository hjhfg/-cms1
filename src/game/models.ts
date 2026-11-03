import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shape } from '../data/regions';

// ================= 图标图集 =================
export const ICON = {
  circle: 0, triangle: 1, square: 2, diamond: 3, pentagon: 4, cross: 5, star: 6, train: 7,
  plain: { circle: 8, triangle: 9, square: 10, diamond: 11, pentagon: 12, cross: 13, star: 14 } as Record<Shape, number>,
  glow: 15, ring: 16, dot: 17, warn: 18,
};
export const ICON_COLS = 8;
export const ICON_ROWS = 3;

function shapePath(g: CanvasRenderingContext2D, shape: Shape | 'train', cx: number, cy: number, r: number) {
  g.beginPath();
  switch (shape) {
    case 'circle':
      g.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
      break;
    case 'triangle': {
      const rr = r * 1.12;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr + rr * 0.18;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      break;
    }
    case 'square':
      g.roundRect(cx - r * 0.82, cy - r * 0.82, r * 1.64, r * 1.64, r * 0.12);
      break;
    case 'diamond':
      g.moveTo(cx, cy - r * 1.1);
      g.lineTo(cx + r * 1.1, cy);
      g.lineTo(cx, cy + r * 1.1);
      g.lineTo(cx - r * 1.1, cy);
      g.closePath();
      break;
    case 'pentagon':
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        const x = cx + Math.cos(a) * r * 1.05;
        const y = cy + Math.sin(a) * r * 1.05;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      break;
    case 'cross': {
      const a = r * 0.36;
      const b = r * 1.0;
      g.moveTo(cx - a, cy - b);
      g.lineTo(cx + a, cy - b);
      g.lineTo(cx + a, cy - a);
      g.lineTo(cx + b, cy - a);
      g.lineTo(cx + b, cy + a);
      g.lineTo(cx + a, cy + a);
      g.lineTo(cx + a, cy + b);
      g.lineTo(cx - a, cy + b);
      g.lineTo(cx - a, cy + a);
      g.lineTo(cx - b, cy + a);
      g.lineTo(cx - b, cy - a);
      g.lineTo(cx - a, cy - a);
      g.closePath();
      break;
    }
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r * 1.15 : r * 0.5;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      break;
    case 'train':
      g.roundRect(cx - r * 0.95, cy - r * 0.62, r * 1.9, r * 1.24, r * 0.4);
      break;
  }
}

export function makeIconAtlas(): THREE.CanvasTexture {
  const C = 128;
  const cv = document.createElement('canvas');
  cv.width = C * ICON_COLS;
  cv.height = C * ICON_ROWS;
  const g = cv.getContext('2d')!;
  const shapes: Shape[] = ['circle', 'triangle', 'square', 'diamond', 'pentagon', 'cross', 'star'];
  const at = (i: number) => [(i % ICON_COLS) * C + C / 2, Math.floor(i / ICON_COLS) * C + C / 2];
  shapes.forEach((s, i) => {
    const [cx, cy] = at(i);
    shapePath(g, s, cx, cy, 44);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 14;
    g.lineJoin = 'round';
    g.strokeStyle = '#111';
    g.stroke();
    const [px, py] = at(8 + i);
    shapePath(g, s, px, py, 50);
    g.fillStyle = '#fff';
    g.fill();
  });
  {
    const [cx, cy] = at(7);
    shapePath(g, 'train', cx, cy, 50);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 12;
    g.strokeStyle = '#111';
    g.stroke();
    g.fillStyle = '#111';
    g.fillRect(cx - 34, cy - 12, 68, 8);
  }
  {
    const [cx, cy] = at(ICON.glow);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 60);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(cx - 64, cy - 64, 128, 128);
  }
  {
    const [cx, cy] = at(ICON.ring);
    g.beginPath();
    g.arc(cx, cy, 52, 0, Math.PI * 2);
    g.lineWidth = 10;
    g.strokeStyle = '#fff';
    g.stroke();
    const [dx, dy] = at(ICON.dot);
    g.beginPath();
    g.arc(dx, dy, 40, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    const [wx, wy] = at(ICON.warn);
    g.beginPath();
    g.moveTo(wx, wy - 52);
    g.lineTo(wx + 56, wy + 44);
    g.lineTo(wx - 56, wy + 44);
    g.closePath();
    g.fillStyle = '#fff';
    g.fill();
    g.fillStyle = '#111';
    g.fillRect(wx - 5, wy - 18, 10, 36);
    g.fillRect(wx - 5, wy + 24, 10, 10);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function iconRect(i: number): [number, number, number, number] {
  const col = i % ICON_COLS;
  const row = Math.floor(i / ICON_COLS);
  return [col / ICON_COLS, 1 - (row + 1) / ICON_ROWS, (col + 1) / ICON_COLS, 1 - row / ICON_ROWS];
}

// ================= 程序化纹理 =================
function hash(x: number, y: number, s: number) {
  let h = x * 374761393 + y * 668265263 + s * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function periodicNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const p = (a: number, b: number) => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = p(xi, yi);
  const b = p(xi + 1, yi);
  const c = p(xi, yi + 1);
  const d = p(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbmField(size: number, octaves: number, seed: number, base = 4): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 0.5;
      let f = base;
      let v = 0;
      for (let o = 0; o < octaves; o++) {
        v += amp * periodicNoise((x / size) * f, (y / size) * f, f, seed + o * 17);
        amp *= 0.5;
        f *= 2;
      }
      out[y * size + x] = v;
    }
  }
  return out;
}

export function makeNoiseTexture(size = 256, seed = 3, lo = 0.72, hi = 1.0): THREE.CanvasTexture {
  const f = fbmField(size, 5, seed, 4);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(1, (f[i] - 0.25) / 0.6));
    const c = Math.round((lo + (hi - lo) * v) * 255);
    img.data[i * 4] = c;
    img.data[i * 4 + 1] = c;
    img.data[i * 4 + 2] = c;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeWaterNormal(size = 256): THREE.CanvasTexture {
  const h = fbmField(size, 5, 11, 4);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 7;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 7;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      img.data[o] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function makeBallastTexture(): THREE.CanvasTexture {
  const w = 128;
  const hgt = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = hgt;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#7b7a76';
  g.fillRect(0, 0, w, hgt);
  for (let i = 0; i < 2600; i++) {
    const v = 90 + Math.random() * 90;
    g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
    g.fillRect(Math.random() * w, Math.random() * hgt, 2 + Math.random() * 2, 2 + Math.random() * 2);
  }
  // 轨枕 (每 64px 一根 = 0.6m)
  for (let k = 0; k < 4; k++) {
    const y = k * 64 + 24;
    g.fillStyle = '#9a9a98';
    g.fillRect(14, y, w - 28, 22);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(14, y + 18, w - 28, 4);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/** 高铁箱梁混凝土：预制节段拼缝 + 水渍 + 细骨料颗粒 */
export function makeConcreteTexture(): THREE.CanvasTexture {
  const w = 128;
  const hgt = 128;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = hgt;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#b9b6ad';
  g.fillRect(0, 0, w, hgt);
  // 骨料颗粒
  for (let i = 0; i < 5200; i++) {
    const v = 150 + Math.random() * 70;
    g.fillStyle = `rgba(${v},${v - 3},${v - 10},0.5)`;
    g.fillRect(Math.random() * w, Math.random() * hgt, 1 + Math.random() * 1.6, 1);
  }
  // 水渍 / 雨痕
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * w;
    const grd = g.createLinearGradient(x, 0, x + 6, 0);
    grd.addColorStop(0, 'rgba(120,120,112,0)');
    grd.addColorStop(0.5, 'rgba(120,120,112,0.16)');
    grd.addColorStop(1, 'rgba(120,120,112,0)');
    g.fillStyle = grd;
    g.fillRect(x, Math.random() * hgt * 0.5, 6, hgt * (0.3 + Math.random() * 0.6));
  }
  // 预制节段拼缝（横向）
  g.strokeStyle = 'rgba(96,94,88,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0.5);
  g.lineTo(w, 0.5);
  g.stroke();
  // 纵向腹板分界
  g.strokeStyle = 'rgba(104,102,96,0.35)';
  g.lineWidth = 1.5;
  for (const x of [0.22, 0.5, 0.78]) {
    g.beginPath();
    g.moveTo(x * w, 0);
    g.lineTo(x * w, hgt);
    g.stroke();
  }
  // 边缘排水槽阴影
  const sh = g.createLinearGradient(0, 0, w, 0);
  sh.addColorStop(0, 'rgba(60,60,56,0.35)');
  sh.addColorStop(0.12, 'rgba(60,60,56,0)');
  sh.addColorStop(0.88, 'rgba(60,60,56,0)');
  sh.addColorStop(1, 'rgba(60,60,56,0.35)');
  g.fillStyle = sh;
  g.fillRect(0, 0, w, hgt);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 隔音屏 / 护栏板：竖向肋条 + 底部混凝土基座 */
export function makeBarrierTexture(): THREE.CanvasTexture {
  const w = 64;
  const hgt = 64;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = hgt;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#dfe3e4';
  g.fillRect(0, 0, w, hgt);
  g.fillStyle = 'rgba(150,158,162,0.55)';
  g.fillRect(0, hgt * 0.62, w, hgt * 0.38);
  for (let k = 0; k < 4; k++) {
    g.fillStyle = 'rgba(120,130,136,0.45)';
    g.fillRect(k * 16 + 7, 0, 3, hgt * 0.62);
  }
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(0, hgt * 0.60, w, 2);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeFacadeTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const W = 128;
  const H = 256;
  const a = document.createElement('canvas');
  const b = document.createElement('canvas');
  a.width = b.width = W;
  a.height = b.height = H;
  const g = a.getContext('2d')!;
  const e = b.getContext('2d')!;
  g.fillStyle = '#b9bcc0';
  g.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const cols = 6;
  const rows = 16;
  const cw = W / cols;
  const rh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + 3;
      const y = r * rh + 3;
      g.fillStyle = Math.random() < 0.5 ? '#38485a' : '#2b3947';
      g.fillRect(x, y, cw - 6, rh - 6);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(x, y, cw - 6, 2);
      if (Math.random() < 0.32) {
        e.fillStyle = Math.random() < 0.7 ? '#ffd9a0' : '#bfe3ff';
        e.fillRect(x, y, cw - 6, rh - 6);
      }
    }
  }
  const m = new THREE.CanvasTexture(a);
  const em = new THREE.CanvasTexture(b);
  for (const t of [m, em]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  m.colorSpace = THREE.SRGBColorSpace;
  em.colorSpace = THREE.SRGBColorSpace;
  return { map: m, emissive: em };
}

export function makeEscalatorTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#2a2e33';
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = '#9aa4ad';
    g.fillRect(4, i * 16 + 2, 56, 3);
    g.fillStyle = '#4b5159';
    g.fillRect(4, i * 16 + 6, 56, 8);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ================= 车厢几何（单位：米） =================
function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function loft(section: [number, number][], rings: { z: number; sx: number; sy: number }[], baseY: number) {
  const m = section.length;
  const pos: number[] = [];
  rings.forEach((r) => section.forEach(([x, y]) => pos.push(x * r.sx, baseY + (y - baseY) * r.sy, r.z)));
  const idx: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      const c = (i + 1) * m + j;
      const d = (i + 1) * m + ((j + 1) % m);
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  const addCap = (ringIdx: number) => {
    const r = rings[ringIdx];
    const ci = pos.length / 3;
    pos.push(0, baseY + (2.2 - baseY) * r.sy, r.z);
    for (let j = 0; j < m; j++) idx.push(ci, ringIdx * m + j, ringIdx * m + ((j + 1) % m));
  };
  addCap(0);
  addCap(rings.length - 1);
  // 逐三角形修正朝向
  const zc = (rings[0].z + rings[rings.length - 1].z) / 2;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const A = new THREE.Vector3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
    const B = new THREE.Vector3(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    const C = new THREE.Vector3(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    const cen = new THREE.Vector3().add(A).add(B).add(C).multiplyScalar(1 / 3);
    const out = cen.clone().sub(new THREE.Vector3(0, 2.2, zc));
    if (n.dot(out) < 0) {
      idx[t + 1] = c;
      idx[t + 2] = b;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface CarGeoms {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  stripe: THREE.BufferGeometry;
  light: THREE.BufferGeometry;
}

export function buildCarGeoms(cab: boolean): CarGeoms {
  const section: [number, number][] = [
    [-1.5, 0.7], [1.5, 0.7], [1.5, 2.5], [1.4, 3.2], [1.05, 3.62], [0.5, 3.78], [-0.5, 3.78], [-1.05, 3.62], [-1.4, 3.2], [-1.5, 2.5],
  ];
  const rings = cab
    ? [
        { z: -10, sx: 1, sy: 1 }, { z: 7.6, sx: 1, sy: 1 }, { z: 8.6, sx: 0.98, sy: 0.97 }, { z: 9.4, sx: 0.9, sy: 0.9 }, { z: 10, sx: 0.76, sy: 0.84 },
      ]
    : [{ z: -10, sx: 1, sy: 1 }, { z: 10, sx: 1, sy: 1 }];
  const paint: THREE.BufferGeometry[] = [loft(section, rings, 0.7)];
  const glass: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const stripe: THREE.BufferGeometry[] = [];
  const light: THREE.BufferGeometry[] = [];
  const winZ = [-4.8, 0, 4.8];
  for (const sgn of [-1, 1]) {
    const x = sgn * 1.512;
    for (const z of winZ) glass.push(box(0.04, 1.0, 3.0, x, 2.0, z));
    glass.push(box(0.04, 1.0, 1.7, x, 2.0, -9.0));
    if (!cab) glass.push(box(0.04, 1.0, 1.7, x, 2.0, 9.0));
    for (const z of [-7.2, -2.4, 2.4, 7.2]) dark.push(box(0.05, 1.75, 1.3, x, 1.65, z));
    const len = cab ? 18.4 : 20;
    stripe.push(box(0.05, 0.26, len, x, 1.0, cab ? -0.8 : 0));
    // 车裙
    dark.push(box(0.06, 0.3, 17, sgn * 1.51, 0.75, -0.5));
  }
  // 车顶设备
  dark.push(box(2.0, 0.34, 3.2, 0, 3.9, -4.2));
  dark.push(box(2.0, 0.34, 3.2, 0, 3.9, 3.2));
  // 底盘与转向架
  dark.push(box(2.4, 0.42, 12, 0, 0.62, 0));
  for (const z of [-6.6, 6.6]) {
    dark.push(box(2.1, 0.3, 2.6, z === 0 ? 0 : 0, 0.55, z));
    for (const wz of [-0.9, 0.9]) {
      for (const wx of [-0.72, 0.72]) {
        const w = new THREE.CylinderGeometry(0.46, 0.46, 0.14, 14);
        w.rotateZ(Math.PI / 2);
        w.translate(wx, 0.46, z + wz);
        dark.push(w);
      }
    }
  }
  if (cab) {
    // 风挡玻璃 + 车头灯
    glass.push(box(1.7, 1.15, 0.04, 0, 2.45, 10.0));
    for (const x of [-0.78, 0.78]) light.push(box(0.34, 0.2, 0.05, x, 1.25, 10.0));
    stripe.push(box(1.7, 0.2, 0.05, 0, 1.75, 10.0));
    // 车头下方排障器
    dark.push(box(1.7, 0.25, 0.1, 0, 0.8, 9.97));
  }
  if (!light.length) light.push(box(0.001, 0.001, 0.001, 0, -50, 0));
  const m = (a: THREE.BufferGeometry[]) => mergeGeometries(a, false)!;
  return { paint: m(paint), glass: m(glass), dark: m(dark), stripe: m(stripe), light: m(light) };
}

export function shapeToIcon(s: Shape) {
  return ICON.plain[s];
}
export function shapeToOutlined(s: Shape) {
  return ICON[s];
}
