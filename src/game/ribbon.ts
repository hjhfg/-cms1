import * as THREE from 'three';

export interface RibbonUniforms {
  uHalf: { value: number };
  uCenter: { value: number };
  uLaneW: { value: number };
  uLift: { value: number };
}

export function makeRibbonUniforms(half: number, center = 0, laneW = 0, lift = 0): RibbonUniforms {
  return { uHalf: { value: half }, uCenter: { value: center }, uLaneW: { value: laneW }, uLift: { value: lift } };
}

// 沿路径生成带状网格；宽度在顶点着色器里按 uniform 展开
export function buildRibbonGeometry(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  zs: ArrayLike<number>,
  cum: ArrayLike<number>,
  lane: ArrayLike<number> | null,
  uvScale: number,
  step = 1,
): THREE.BufferGeometry {
  const idxs: number[] = [];
  const n = xs.length;
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  const m = idxs.length;
  const pos = new Float32Array(m * 2 * 3);
  const side = new Float32Array(m * 2);
  const perp = new Float32Array(m * 2 * 2);
  const laneA = new Float32Array(m * 2);
  const uv = new Float32Array(m * 2 * 2);
  const nor = new Float32Array(m * 2 * 3);
  for (let k = 0; k < m; k++) {
    const i = idxs[k];
    const ip = idxs[Math.max(0, k - 1)];
    const inx = idxs[Math.min(m - 1, k + 1)];
    let dx = xs[inx] - xs[ip];
    let dz = zs[inx] - zs[ip];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const px = -dz;
    const pz = dx;
    for (let s = 0; s < 2; s++) {
      const o = k * 2 + s;
      pos[o * 3] = xs[i];
      pos[o * 3 + 1] = ys[i];
      pos[o * 3 + 2] = zs[i];
      side[o] = s === 0 ? -1 : 1;
      perp[o * 2] = px;
      perp[o * 2 + 1] = pz;
      laneA[o] = lane ? lane[i] : 0;
      uv[o * 2] = s;
      uv[o * 2 + 1] = cum[i] * uvScale;
      nor[o * 3 + 1] = 1;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < m - 1; k++) {
    const a = k * 2;
    const b = k * 2 + 1;
    const c = (k + 1) * 2;
    const d = (k + 1) * 2 + 1;
    index.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aPerp', new THREE.BufferAttribute(perp, 2));
  g.setAttribute('aLane', new THREE.BufferAttribute(laneA, 1));
  g.setIndex(index);
  // 大范围包围球（顶点着色器会改变宽度）
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 5;
  return g;
}

export function patchRibbonMaterial<T extends THREE.Material>(mat: T, u: RibbonUniforms): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHalf = u.uHalf;
    shader.uniforms.uCenter = u.uCenter;
    shader.uniforms.uLaneW = u.uLaneW;
    shader.uniforms.uLift = u.uLift;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aSide;attribute vec2 aPerp;attribute float aLane;uniform float uHalf;uniform float uCenter;uniform float uLaneW;uniform float uLift;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.xz += aPerp * (aSide * uHalf + uCenter + aLane * uLaneW);\ntransformed.y += uLift;',
      );
  };
  mat.customProgramCacheKey = () => 'ribbon';
  return mat;
}

// ========== 屏幕像素宽度的无光照带状线（边界/海岸线） ==========
export interface ScreenRibbonUniforms {
  uPx: { value: number };
  uWidth: { value: number };
  uLift: { value: number };
  uColor: { value: THREE.Color };
  uOpacity: { value: number };
}

export function makeScreenRibbonMaterial(color: number, widthPx: number, opacity: number): { mat: THREE.ShaderMaterial; u: ScreenRibbonUniforms } {
  const u: ScreenRibbonUniforms = {
    uPx: { value: 1 },
    uWidth: { value: widthPx },
    uLift: { value: 0 },
    uColor: { value: new THREE.Color(color) },
    uOpacity: { value: opacity },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: `
      attribute float aSide; attribute vec2 aPerp;
      uniform float uPx; uniform float uWidth; uniform float uLift;
      void main(){
        vec3 p = position;
        p.xz += aPerp * aSide * uPx * uWidth * 0.5;
        p.y += uLift;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      void main(){ gl_FragColor = vec4(uColor, uOpacity); }`,
    transparent: true,
    depthWrite: false,
  });
  return { mat, u };
}

// 将线段集合 (每段独立四边形) 转换为带状几何
export function buildSegmentRibbon(segs: [number, number, number, number][], y = 0): THREE.BufferGeometry {
  const n = segs.length;
  const pos = new Float32Array(n * 4 * 3);
  const side = new Float32Array(n * 4);
  const perp = new Float32Array(n * 4 * 2);
  const index: number[] = [];
  segs.forEach(([x1, z1, x2, z2], i) => {
    let dx = x2 - x1;
    let dz = z2 - z1;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // 轻微延长以减少接缝
    const ext = 0.0;
    const pts = [
      [x1 - dx * ext, z1 - dz * ext, -1],
      [x1 - dx * ext, z1 - dz * ext, 1],
      [x2 + dx * ext, z2 + dz * ext, -1],
      [x2 + dx * ext, z2 + dz * ext, 1],
    ];
    pts.forEach((p, k) => {
      const o = i * 4 + k;
      pos[o * 3] = p[0];
      pos[o * 3 + 1] = y;
      pos[o * 3 + 2] = p[1];
      side[o] = p[2];
      perp[o * 2] = -dz;
      perp[o * 2 + 1] = dx;
    });
    const b = i * 4;
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aPerp', new THREE.BufferAttribute(perp, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 50;
  return g;
}

/** 沿路径立起一道竖墙（桥梁腹板 / 护栏 / 隔音屏）：底部与顶部各一层顶点 */
export function buildWallGeometry(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  zs: ArrayLike<number>,
  cum: ArrayLike<number>,
  half: number,
  side: 1 | -1,
  hBottom: number,
  hTop: number,
  uvScale: number,
  step = 1,
): THREE.BufferGeometry {
  const n = xs.length;
  const idxs: number[] = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  const m = idxs.length;
  const pos = new Float32Array(m * 2 * 3);
  const uv = new Float32Array(m * 2 * 2);
  const nor = new Float32Array(m * 2 * 3);
  for (let k = 0; k < m; k++) {
    const i = idxs[k];
    const ip = idxs[Math.max(0, k - 1)];
    const inx = idxs[Math.min(m - 1, k + 1)];
    let dx = xs[inx] - xs[ip];
    let dz = zs[inx] - zs[ip];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const px = -dz * side;
    const pz = dx * side;
    for (let r = 0; r < 2; r++) {
      const o = k * 2 + r;
      pos[o * 3] = xs[i] + px * half;
      pos[o * 3 + 1] = ys[i] + (r === 0 ? hBottom : hTop);
      pos[o * 3 + 2] = zs[i] + pz * half;
      uv[o * 2] = cum[i] * uvScale;
      uv[o * 2 + 1] = r;
      nor[o * 3] = px;
      nor[o * 3 + 2] = pz;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < m - 1; k++) {
    const a = k * 2;
    const b = k * 2 + 1;
    const c = (k + 1) * 2;
    const d = (k + 1) * 2 + 1;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 5;
  return g;
}
