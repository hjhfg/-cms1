import * as THREE from 'three';
import type { Game, Station } from './engine';
import { pathAt, type PathSample } from './path';
import { makeEscalatorTexture } from './models';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 28);

export interface StationMats {
  concrete: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  plaza: THREE.MeshStandardMaterial;
  tile: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  roof: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  lamp: THREE.MeshStandardMaterial;
  escalator: THREE.MeshStandardMaterial;
  elevator: THREE.MeshStandardMaterial;
  colorMats: Map<string, THREE.MeshStandardMaterial>;
  escTex: THREE.CanvasTexture;
}

export function makeStationMats(): StationMats {
  const escTex = makeEscalatorTexture();
  escTex.repeat.set(1, 6);
  return {
    concrete: new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.85, metalness: 0.02 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x6b6e73, roughness: 0.9 }),
    plaza: new THREE.MeshStandardMaterial({ color: 0xa7a59d, roughness: 0.95 }),
    tile: new THREE.MeshStandardMaterial({ color: 0xc9cbcc, roughness: 0.45, metalness: 0.05 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xaab3bb, roughness: 0.3, metalness: 0.9 }),
    roof: new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.26, depthWrite: false, envMapIntensity: 1.6 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9fd0e8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, envMapIntensity: 2.2, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false,
    }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.6, roughness: 0.4 }),
    escalator: new THREE.MeshStandardMaterial({ map: escTex, roughness: 0.5, metalness: 0.5 }),
    elevator: new THREE.MeshStandardMaterial({ color: 0xdfefff, emissive: 0x9fd7ff, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.4 }),
    colorMats: new Map(),
    escTex,
  };
}

function colorMat(m: StationMats, color: string) {
  let c = m.colorMats.get(color);
  if (!c) {
    c = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.4 });
    m.colorMats.set(color, c);
  }
  return c;
}

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number], shadow = true) {
  const o = new THREE.Mesh(geo, mat);
  o.position.set(...pos);
  o.scale.set(...scale);
  o.castShadow = shadow;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

export class StationView {
  group = new THREE.Group();
  sig = '';
  cabin: THREE.Mesh | null = null;
  cabinTop = 0;
  private samp: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };

  constructor(public st: Station, private game: Game, private mats: StationMats) {
    this.group.position.set(st.x, 0, st.z);
    this.group.scale.setScalar(0.001);
  }

  signature() {
    return this.st.lineIds.map((id) => {
      const l = this.game.lineOf(id);
      return id + ':' + (l ? l.path.version : 0);
    }).join('|');
  }

  dispose() {
    this.group.clear();
  }

  build() {
    const { st, game, mats } = this;
    this.group.clear();
    this.cabin = null;
    const lines = st.lineIds.map((id) => game.lineOf(id)).filter((l): l is NonNullable<typeof l> => !!l);
    const hub = lines.length >= 2;
    this.sig = this.signature();
    const g = this.group;

    // 站前广场
    const R = hub ? 95 : lines.length ? 62 : 38;
    mesh(g, CYL, mats.plaza, [0, 0.07, 0], [R, 0.16, R]).receiveShadow = true;

    const dirs: number[] = [];
    let maxE = 0;
    lines.forEach((line, k) => {
      const idx = line.stations.indexOf(st.id);
      const s = line.path.stationS[idx];
      pathAt(line.path, s, this.samp);
      const yaw = Math.atan2(this.samp.tx, this.samp.tz);
      dirs.push(yaw);
      const e = 8000 + (hub ? (st.lineIds.indexOf(line.id) + 1) * 6000 : 0);
      maxE = Math.max(maxE, e);
      const pg = new THREE.Group();
      pg.rotation.y = yaw;
      g.add(pg);
      const L = 150;
      // 侧式站台
      for (const sgn of [-1, 1]) {
        mesh(pg, BOX, mats.tile, [sgn * 4.7, e + 0.5, 0], [5.2, 1.0, L]);
        mesh(pg, BOX, mats.yellow, [sgn * 2.25, e + 1.01, 0], [0.4, 0.04, L], false);
      }
      // 高架桥面与桥墩
      if (e > 1) {
        mesh(pg, BOX, mats.deck, [0, e - 1.0, 0], [17, 1.9, L + 8]);
        for (const z of [-62, 62]) {
          for (const x of [-5, 5]) mesh(pg, CYL, mats.concrete, [x, (e - 1.9) / 2, z], [1.2, e - 1.9, 1.2]);
          mesh(pg, BOX, mats.concrete, [0, e - 2.4, z], [13, 1.0, 3]);
        }
      } else {
        mesh(pg, BOX, mats.deck, [0, 0.17, 0], [17, 0.34, L + 8]);
      }
      // 雨棚
      mesh(pg, BOX, mats.roof, [0, e + 7.0, 0], [16.4, 0.35, L - 20]);
      const cm = colorMat(mats, line.color);
      mesh(pg, BOX, cm, [0, e + 7.35, (L - 20) / 2], [16.4, 0.5, 0.6], false);
      mesh(pg, BOX, cm, [0, e + 7.35, -(L - 20) / 2], [16.4, 0.5, 0.6], false);
      for (const sgn of [-1, 1]) {
        mesh(pg, BOX, cm, [sgn * 8.2, e + 7.0, 0], [0.4, 0.5, L - 20], false);
        // 立柱
        for (let z = -60; z <= 60; z += 15) mesh(pg, BOX, mats.steel, [sgn * 7.0, e + 4, z], [0.55, 6.0, 0.55]);
        // 灯带
        mesh(pg, BOX, mats.lamp, [sgn * 4.2, e + 6.7, 0], [0.4, 0.12, L - 30], false);
        // 站名牌
        for (const z of [-40, 0, 40]) mesh(pg, BOX, cm, [sgn * 6.7, e + 4.6, z], [0.2, 1.1, 5], false);
      }
      // 扶梯（动态条纹）
      const run = e / Math.tan(0.52);
      const sign = k % 2 === 0 ? 1 : -1;
      if (e > 1) {
        const len = Math.hypot(run, e);
        const esc = mesh(pg, BOX, mats.escalator, [sign * 11.2, e / 2 + 0.6, 30 * sign + (run / 2) * sign], [2.4, 0.35, len]);
        esc.rotation.x = Math.atan2(e, run) * (sign === 1 ? 1 : -1);
        mesh(pg, BOX, mats.glass, [sign * 11.2, e / 2 + 2.2, 30 * sign + (run / 2) * sign], [3.0, 3.4, len]).rotation.x = esc.rotation.x;
      }
      // 车站出入口
      if (!hub) {
        mesh(pg, BOX, mats.glass, [14, 3.2, 0], [9, 6.2, 22]);
        mesh(pg, BOX, mats.concrete, [14, 6.5, 0], [10, 0.5, 24]);
      }
    });

    if (!lines.length) {
      mesh(g, BOX, mats.glass, [0, 4, 0], [20, 8, 12]);
      mesh(g, BOX, mats.concrete, [0, 8.2, 0], [22, 0.6, 14]);
    }

    // 立体换乘大厅（玻璃中庭 + 观光电梯）
    if (hub) {
      let best = 0;
      let bestClear = -1;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        let clear = 9;
        for (const y of dirs) {
          let d = Math.abs(((ang - y + Math.PI * 4) % Math.PI) );
          d = Math.min(d, Math.PI - d);
          clear = Math.min(clear, d);
        }
        if (clear > bestClear) {
          bestClear = clear;
          best = ang;
        }
      }
      const ax = Math.sin(best) * 62;
      const az = Math.cos(best) * 62;
      const H = maxE + 14;
      mesh(g, CYL, mats.glass, [ax, H / 2, az], [15, H, 15], false);
      mesh(g, CYL, mats.concrete, [ax, H + 0.4, az], [16, 0.8, 16]);
      mesh(g, CYL, mats.steel, [ax, H + 1.2, az], [3, 0.5, 3]);
      for (let k = 0; k <= lines.length; k++) {
        const y = k === 0 ? 0.3 : (k) * 9 + 0.4;
        mesh(g, CYL, mats.tile, [ax, y, az], [14.2, 0.5, 14.2]);
      }
      // 中央电梯井
      mesh(g, BOX, mats.steel, [ax, H / 2, az], [4.2, H, 4.2]);
      const cab = mesh(g, BOX, mats.elevator, [ax + 2.4, 2, az], [2.2, 3.2, 2.2], false);
      this.cabin = cab;
      this.cabinTop = maxE + 2;
      // 通往各层的空桥
      lines.forEach((line) => {
        const e = (st.lineIds.indexOf(line.id) + 1) * 9 + 0.4;
        const bridge = new THREE.Group();
        bridge.position.set(0, e + 1.4, 0);
        g.add(bridge);
        const len = Math.hypot(ax, az) - 8;
        const mid = new THREE.Vector3(ax * 0.5, 0, az * 0.5);
        const b = mesh(bridge, BOX, mats.glass, [mid.x, 1.2, mid.z], [3.4, 3.0, len], false);
        b.rotation.y = Math.atan2(ax, az);
        const f = mesh(bridge, BOX, mats.concrete, [mid.x, -0.3, mid.z], [3.8, 0.5, len]);
        f.rotation.y = Math.atan2(ax, az);
      });
    }

    // 路灯
    for (let i = 0; i < (hub ? 8 : 4); i++) {
      const a = (i / (hub ? 8 : 4)) * Math.PI * 2 + 0.3;
      const rr = R * 0.92;
      const x = Math.sin(a) * rr;
      const z = Math.cos(a) * rr;
      mesh(g, CYL, mats.steel, [x, 4.5, z], [0.18, 9, 0.18]);
      mesh(g, BOX, mats.lamp, [x, 9.1, z], [1.4, 0.2, 0.6], false);
    }
  }

  animate(time: number) {
    if (this.cabin) {
      const t = (Math.sin(time * 0.6) * 0.5 + 0.5);
      this.cabin.position.y = 2 + t * this.cabinTop;
    }
  }
}
