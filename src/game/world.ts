import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITIES } from '../data/regions';
import type { Game, Line, Train } from './engine';
import { REGIONS, isLand } from './geo';
import { buildRibbonGeometry, buildSegmentRibbon, makeRibbonUniforms, makeScreenRibbonMaterial, patchRibbonMaterial, type RibbonUniforms, type ScreenRibbonUniforms } from './ribbon';
import { buildCarGeoms, makeBallastTexture, makeFacadeTextures, makeNoiseTexture, makeWaterNormal, type CarGeoms } from './models';
import { pathAt, type PathSample } from './path';
import { makeStationMats, StationView, type StationMats } from './stationView';

export type MapMode = 'political' | 'heat' | 'terrain';
export type Quality = 'low' | 'mid' | 'high';

const COLOR_BY_ID = new Map(CITIES.map((c) => [c.id, c.color]));

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface RegionInfo {
  id: string;
  name: string;
  short: string;
  x: number;
  z: number;
  size: number;
}

export const REGION_INFO: RegionInfo[] = REGIONS.map((r) => {
  let best: [number, number][] = [];
  let bestA = 0;
  for (const poly of r.polys) {
    const ring = poly[0];
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    if (Math.abs(a) > bestA) {
      bestA = Math.abs(a);
      best = ring;
    }
  }
  let cx = 0;
  let cz = 0;
  for (const p of best) {
    cx += p[0];
    cz += p[1];
  }
  const short = CITIES.find((c) => c.id === r.id)?.short ?? r.name;
  return { id: r.id, name: r.name, short, x: cx / best.length, z: cz / best.length, size: Math.sqrt(bestA / 2) };
});

class LineView {
  group = new THREE.Group();
  ribbonU: RibbonUniforms;
  ribbonMat: THREE.MeshStandardMaterial;
  version = -1;
  pierMesh: THREE.InstancedMesh | null = null;
  real: THREE.Mesh[] = [];
  sig = '';
  constructor(public lineId: number) {
    this.ribbonU = makeRibbonUniforms(0.002, 0, 0.006, 0.001);
    this.ribbonMat = patchRibbonMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.1, transparent: true, depthWrite: false, depthTest: false }),
      this.ribbonU,
    );
  }
}

export class World {
  scene = new THREE.Scene();
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sea: THREE.Mesh;
  seaMat: THREE.MeshPhysicalMaterial;
  waterNormal: THREE.CanvasTexture;
  regionMeshes = new Map<string, THREE.Mesh>();
  regionMats = new Map<string, THREE.MeshStandardMaterial>();
  borderU: ScreenRibbonUniforms[] = [];
  coastU: ScreenRibbonUniforms[] = [];
  buildingChunks: { mesh: THREE.InstancedMesh; x: number; z: number }[] = [];
  buildingMat: THREE.MeshStandardMaterial;
  landmarks = new THREE.Group();
  landmarkMats: THREE.MeshStandardMaterial[] = [];
  lineViews = new Map<number, LineView>();
  stationViews = new Map<number, StationView>();
  stationMats: StationMats;
  stationGroup = new THREE.Group();
  ballastTex: THREE.CanvasTexture;
  realMats: { ballast: THREE.MeshStandardMaterial; rail: THREE.MeshStandardMaterial; deck: THREE.MeshStandardMaterial };
  carMeshes: { kind: 'mid' | 'cab'; parts: THREE.InstancedMesh[]; stripe: THREE.InstancedMesh; cap: number }[] = [];
  carMats!: { paint: THREE.MeshPhysicalMaterial; glass: THREE.MeshPhysicalMaterial; dark: THREE.MeshStandardMaterial; stripe: THREE.MeshStandardMaterial; light: THREE.MeshStandardMaterial };
  fogColor = new THREE.Color();
  night = 0;
  daylight = 1;
  mode: MapMode = 'political';
  selectedRegion: string | null = null;
  lastRegionUpdate = 0;
  private samp: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private upAxis = new THREE.Vector3(0, 1, 0);
  shadowSize = 1;
  time = 0;
  curDist = 100;
  neutralLand = new THREE.Color(0x77805f);

  constructor(public game: Game, public quality: Quality, renderer: THREE.WebGLRenderer) {
    const sc = this.scene;
    sc.background = new THREE.Color(0xaec7de);
    sc.fog = new THREE.Fog(0xaec7de, 10, 1000);

    // 环境光照（程序化天空 → PMREM，用于 PBR 反射）
    {
      const pm = new THREE.PMREMGenerator(renderer);
      const es = new THREE.Scene();
      const skyGeo = new THREE.SphereGeometry(50, 32, 16);
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {},
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `varying vec3 vP;
          void main(){
            float h = vP.y;
            vec3 zen = vec3(0.16,0.34,0.72);
            vec3 hor = vec3(0.86,0.92,0.97);
            vec3 gnd = vec3(0.30,0.32,0.30);
            vec3 c = h>0.0 ? mix(hor, zen, pow(h,0.55)) : mix(hor, gnd, smoothstep(0.0,-0.25,h));
            vec3 sd = normalize(vec3(-0.4,0.75,0.35));
            float s = max(dot(vP, sd),0.0);
            c += vec3(1.0,0.86,0.62)*(pow(s,600.0)*40.0 + pow(s,12.0)*0.35);
            gl_FragColor = vec4(c,1.0);
          }`,
      });
      es.add(new THREE.Mesh(skyGeo, skyMat));
      sc.environment = pm.fromScene(es, 0.02).texture;
      pm.dispose();
      skyGeo.dispose();
    }

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4438, 0.25);
    sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
    this.sun.castShadow = quality !== 'low';
    const ms = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(ms, ms);
    this.sun.shadow.bias = -0.0003;
    sc.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x7f9cff, 0.0);
    this.moon.position.set(0.4, 1, -0.6);
    sc.add(this.moon);

    // ---------- 海洋 ----------
    this.waterNormal = makeWaterNormal(256);
    const seaTile = 2.4;
    this.waterNormal.repeat.set(9000 / seaTile, 9000 / seaTile);
    this.seaMat = new THREE.MeshPhysicalMaterial({
      color: 0x14506b, roughness: 0.16, metalness: 0.0, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.55, 0.55),
      envMapIntensity: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.2,
    });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.seaMat);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.receiveShadow = true;
    this.sea.renderOrder = -10;
    this.seaMat.depthWrite = false;
    sc.add(this.sea);

    // ---------- 陆地 ----------
    const noise = makeNoiseTexture(256, 5, 0.7, 1.0);
    noise.repeat.set(1 / 14, 1 / 14);
    for (const r of REGIONS) {
      const geos: THREE.BufferGeometry[] = [];
      for (const poly of r.polys) {
        const shape = new THREE.Shape(poly[0].map(([x, z]) => new THREE.Vector2(x, -z)));
        for (let i = 1; i < poly.length; i++) shape.holes.push(new THREE.Path(poly[i].map(([x, z]) => new THREE.Vector2(x, -z))));
        try {
          const g = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false, curveSegments: 1 });
          g.rotateX(-Math.PI / 2);
          g.translate(0, -2, 0);
          geos.push(g);
        } catch {
          /* ignore degenerate */
        }
      }
      if (!geos.length) continue;
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
      const mat = new THREE.MeshStandardMaterial({ color: COLOR_BY_ID.get(r.id) ?? '#888', map: noise, roughness: 0.92, metalness: 0.0, bumpMap: noise, bumpScale: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.userData.regionId = r.id;
      sc.add(mesh);
      this.regionMeshes.set(r.id, mesh);
      this.regionMats.set(r.id, mat);
    }

    // ---------- 边界 / 海岸线 ----------
    {
      const coast: [number, number, number, number][] = [];
      const border: [number, number, number, number][] = [];
      for (const r of REGIONS) {
        for (const poly of r.polys) {
          for (const ring of poly) {
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i];
              const b = ring[(i + 1) % ring.length];
              const mx = (a[0] + b[0]) / 2;
              const mz = (a[1] + b[1]) / 2;
              let dx = b[0] - a[0];
              let dz = b[1] - a[1];
              const l = Math.hypot(dx, dz) || 1;
              dx /= l;
              dz /= l;
              const s1 = isLand(mx - dz * 1.6, mz + dx * 1.6);
              const s2 = isLand(mx + dz * 1.6, mz - dx * 1.6);
              (s1 && s2 ? border : coast).push([a[0], a[1], b[0], b[1]]);
            }
          }
        }
      }
      const addRibbon = (segs: [number, number, number, number][], color: number, w: number, op: number, order: number, store: ScreenRibbonUniforms[]) => {
        const { mat, u } = makeScreenRibbonMaterial(color, w, op);
        const m = new THREE.Mesh(buildSegmentRibbon(segs), mat);
        m.renderOrder = order;
        m.frustumCulled = false;
        sc.add(m);
        store.push(u);
      };
      addRibbon(coast, 0x57c2d4, 8, 0.16, 1, this.coastU);
      addRibbon(coast, 0xcdeff2, 2.6, 0.4, 2, this.coastU);
      addRibbon(coast, 0xf4efe0, 1.2, 0.8, 3, this.coastU);
      addRibbon(border, 0x2d2417, 1.5, 0.65, 3, this.borderU);
    }

    // ---------- 材质（真实轨道） ----------
    this.ballastTex = makeBallastTexture();
    this.realMats = {
      ballast: new THREE.MeshStandardMaterial({ map: this.ballastTex, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
      rail: new THREE.MeshStandardMaterial({ color: 0xc3c9cf, roughness: 0.28, metalness: 0.95, side: THREE.DoubleSide }),
      deck: new THREE.MeshStandardMaterial({ color: 0x70737a, roughness: 0.9, side: THREE.DoubleSide }),
    };
    this.ballastTex.repeat.set(1, 1);

    this.stationMats = makeStationMats();
    sc.add(this.stationGroup);

    // ---------- 建筑 ----------
    const fac = makeFacadeTextures();
    this.buildingMat = new THREE.MeshStandardMaterial({
      map: fac.map, emissiveMap: fac.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5, metalness: 0.2, envMapIntensity: 0.9,
    });
    this.buildBuildings();
    this.buildLandmarks();
    sc.add(this.landmarks);
    this.buildTrains();
  }

  // ================= 建筑 =================
  private buildBuildings() {
    const density = this.quality === 'high' ? 1 : this.quality === 'mid' ? 0.6 : 0.35;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    for (const st of this.game.stations) {
      const rnd = mulberry(st.id * 7919 + 13);
      const R = st.tier === 3 ? 8 : st.tier === 2 ? 4.8 : 3;
      const cell = 0.27;
      const yaw = (rnd() - 0.5) * 0.8;
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const mats: THREE.Matrix4[] = [];
      const cols: THREE.Color[] = [];
      const n = Math.floor(R / cell);
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const lx = i * cell + (rnd() - 0.5) * 0.06;
          const lz = j * cell + (rnd() - 0.5) * 0.06;
          const d = Math.hypot(lx, lz);
          const clear = st.tier === 3 ? 0.5 : st.tier === 2 ? 0.34 : 0.24;
          if (d > R || d < clear) continue;
          const p = Math.exp(-Math.pow(d / R, 2) * 2.4) * (st.tier === 3 ? 1.0 : st.tier === 2 ? 0.8 : 0.65);
          if (rnd() > p * density * 0.95) continue;
          const wx = st.x + lx * cs - lz * sn;
          const wz = st.z + lx * sn + lz * cs;
          if (!isLand(wx, wz)) continue;
          const w = 0.07 + rnd() * 0.1;
          const dd = 0.07 + rnd() * 0.1;
          let h = 0.014 + Math.pow(rnd(), 2.2) * 0.035;
          if (st.tier >= 2) h += Math.exp(-Math.pow(d / (R * 0.38), 2)) * (0.015 + Math.pow(rnd(), 1.8) * (st.tier === 3 ? 0.17 : 0.08));
          const m = new THREE.Matrix4().compose(new THREE.Vector3(wx, 0, wz), new THREE.Quaternion().setFromAxisAngle(this.upAxis, yaw + (rnd() < 0.15 ? 0.4 : 0)), new THREE.Vector3(w, h, dd));
          mats.push(m);
          const v = 0.78 + rnd() * 0.22;
          const warm = rnd();
          cols.push(new THREE.Color(v * (0.96 + warm * 0.06), v, v * (1.02 - warm * 0.08)));
        }
      }
      if (!mats.length) continue;
      const mesh = new THREE.InstancedMesh(geo, this.buildingMat, mats.length);
      mats.forEach((m, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, cols[k]);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.buildingChunks.push({ mesh, x: st.x, z: st.z });
    }
  }

  private buildLandmarks() {
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8d0d6, metalness: 0.85, roughness: 0.3, emissive: 0x69d6ff, emissiveIntensity: 0 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x5d7f9c, metalness: 0.9, roughness: 0.12, emissive: 0xffc88a, emissiveIntensity: 0 });
    this.landmarkMats.push(steel, glass);
    const place = (obj: THREE.Object3D, lon: number, lat: number) => {
      const [x, z] = (() => {
        const phi = (lat * Math.PI) / 180;
        return [6371.0088 * ((lon - 113.5) * Math.PI) / 180 * Math.cos(phi), -6371.0088 * ((lat - 22.9) * Math.PI) / 180];
      })();
      obj.position.set(x, 0, z);
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.landmarks.add(obj);
    };
    // 广州塔（小蛮腰）
    {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const h = t * 0.454;
        const r = 0.011 + 0.026 * Math.pow(Math.abs(t - 0.45) / 0.55, 1.7) * (t < 0.45 ? 1 : 0.75);
        pts.push(new THREE.Vector2(r, h));
      }
      const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), steel);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.004, 0.146, 8), steel);
      mast.position.y = 0.454 + 0.073;
      const g = new THREE.Group();
      g.add(body, mast);
      place(g, 113.3245, 23.1065);
    }
    // 平安金融中心 / 香港环球贸易广场 / 澳门旅游塔
    const tower = (h: number, r0: number, r1: number, mat: THREE.Material) => {
      const c = new THREE.CylinderGeometry(r1, r0, h, 4);
      c.rotateY(Math.PI / 4);
      c.translate(0, h / 2, 0);
      return new THREE.Mesh(c, mat);
    };
    {
      const g = new THREE.Group();
      g.add(tower(0.599, 0.05, 0.026, glass));
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.05, 6), steel);
      spire.position.y = 0.62;
      g.add(spire);
      place(g, 114.0525, 22.5365);
    }
    place(tower(0.484, 0.042, 0.03, glass), 114.1602, 22.3035);
    {
      const pts = [new THREE.Vector2(0.012, 0), new THREE.Vector2(0.006, 0.22), new THREE.Vector2(0.004, 0.25), new THREE.Vector2(0.0035, 0.3), new THREE.Vector2(0.0015, 0.338)];
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 16), steel));
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.012, 0.014, 18), glass);
      pod.position.y = 0.2;
      g.add(pod);
      place(g, 113.5372, 22.1806);
    }
  }

  // ================= 列车 =================
  private buildTrains() {
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xeef1f3, metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1218, metalness: 0.9, roughness: 0.06, envMapIntensity: 1.8, emissive: 0xffd9a0, emissiveIntensity: 0.0 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22262b, metalness: 0.6, roughness: 0.55 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25 });
    const light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 4 });
    this.carMats = { paint, glass, dark, stripe, light };
    const make = (kind: 'mid' | 'cab', cap: number) => {
      const g: CarGeoms = buildCarGeoms(kind === 'cab');
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, col = false) => {
        const m = new THREE.InstancedMesh(geo, mat, cap);
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (col) {
          m.setColorAt(0, new THREE.Color(1, 1, 1));
          m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        }
        this.scene.add(m);
        return m;
      };
      const parts = [mk(g.paint, paint), mk(g.glass, glass), mk(g.dark, dark), mk(g.light, light)];
      const stripeMesh = mk(g.stripe, stripe, true);
      this.carMeshes.push({ kind, parts, stripe: stripeMesh, cap });
    };
    make('mid', 420);
    make('cab', 180);
  }

  private updateTrains(dist: number) {
    const f = Math.max(1, dist / 15);
    const sc = 0.001 * f;
    const spacing = 0.0215 * f;
    const mid = this.carMeshes[0];
    const cab = this.carMeshes[1];
    let nm = 0;
    let nc = 0;
    const game = this.game;
    for (const t of game.trains) {
      const line = game.lineOf(t.line);
      if (!line) continue;
      this.tmpC.set(line.color);
      const n = t.cars;
      for (let i = 0; i < n; i++) {
        let s = t.s + t.dir * ((n - 1) / 2 - i) * spacing;
        if (line.loop) s = ((s % line.path.length) + line.path.length) % line.path.length;
        pathAt(line.path, s, this.samp);
        const isCab = i === 0 || i === n - 1;
        const flip = i === n - 1 && n > 1 ? -1 : 1;
        const hx = this.samp.tx * t.dir * flip;
        const hz = this.samp.tz * t.dir * flip;
        this.tmpQ.setFromAxisAngle(this.upAxis, Math.atan2(hx, hz));
        this.tmpV.set(this.samp.x, this.samp.y + 0.00018 * f, this.samp.z);
        this.tmpS.set(sc, sc, sc);
        this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
        const set = isCab ? cab : mid;
        const idx = isCab ? nc : nm;
        if (idx >= set.cap) continue;
        for (const p of set.parts) p.setMatrixAt(idx, this.tmpM);
        set.stripe.setMatrixAt(idx, this.tmpM);
        set.stripe.setColorAt(idx, this.tmpC);
        if (isCab) nc++;
        else nm++;
      }
    }
    for (const [set, c] of [[mid, nm], [cab, nc]] as const) {
      for (const p of set.parts) {
        p.count = c;
        p.instanceMatrix.needsUpdate = true;
      }
      set.stripe.count = c;
      set.stripe.instanceMatrix.needsUpdate = true;
      if (set.stripe.instanceColor) set.stripe.instanceColor.needsUpdate = true;
    }
  }

  // ================= 线路 =================
  private rebuildLine(line: Line) {
    let lv = this.lineViews.get(line.id);
    if (!lv) {
      lv = new LineView(line.id);
      this.lineViews.set(line.id, lv);
      this.scene.add(lv.group);
    }
    if (lv.version === line.path.version) return;
    lv.version = line.path.version;
    lv.group.clear();
    lv.real = [];
    const p = line.path;
    lv.ribbonMat.color.set(line.color);
    lv.ribbonMat.emissive.set(line.color);
    const geoFar = buildRibbonGeometry(p.px, p.py, p.pz, p.cum, p.lane, 416.7, p.n > 1500 ? 2 : 1);
    const ribbon = new THREE.Mesh(geoFar, lv.ribbonMat);
    ribbon.renderOrder = 5;
    ribbon.frustumCulled = false;
    lv.group.add(ribbon);

    const geo = geoFar;
    const mk = (mat: THREE.Material, u: RibbonUniforms, shadow: boolean) => {
      patchRibbonMaterial(mat, u);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.receiveShadow = shadow;
      lv!.group.add(m);
      lv!.real.push(m);
      return m;
    };
    mk(this.cloneMat(this.realMats.deck), makeRibbonUniforms(0.0036, 0, 0.0095, -0.0006), true);
    mk(this.cloneMat(this.realMats.ballast), makeRibbonUniforms(0.0022, 0, 0.0095, 0), true);
    mk(this.cloneMat(this.realMats.rail), makeRibbonUniforms(0.00016, -0.00072, 0.0095, 0.00022), false);
    mk(this.cloneMat(this.realMats.rail), makeRibbonUniforms(0.00016, 0.00072, 0.0095, 0.00022), false);

    // 桥墩
    const piers: number[] = [];
    let acc = 0;
    for (let i = 0; i < p.n; i++) {
      if (i > 0) acc += p.cum[i] - p.cum[i - 1];
      if (p.py[i] > 0.0035 && acc > 0.06) {
        acc = 0;
        piers.push(i);
      }
    }
    if (piers.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.stationMats.concrete, piers.length);
      piers.forEach((i, k) => {
        const h = p.py[i] - 0.0016;
        const dx = p.px[Math.min(p.n - 1, i + 1)] - p.px[Math.max(0, i - 1)];
        const dz = p.pz[Math.min(p.n - 1, i + 1)] - p.pz[Math.max(0, i - 1)];
        this.tmpQ.setFromAxisAngle(this.upAxis, Math.atan2(dx, dz));
        this.tmpV.set(p.px[i] + 0, h / 2, p.pz[i]);
        this.tmpS.set(0.004, h, 0.0025);
        this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
        im.setMatrixAt(k, this.tmpM);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      lv.group.add(im);
      lv.real.push(im as unknown as THREE.Mesh);
    }
  }

  private cloneMat<T extends THREE.Material>(m: T): T {
    return m.clone() as T;
  }

  syncLines(selectedLine: number | null, pxWorld: number, dist: number) {
    const ids = new Set(this.game.lines.map((l) => l.id));
    for (const [id, lv] of this.lineViews) {
      if (!ids.has(id)) {
        this.scene.remove(lv.group);
        this.lineViews.delete(id);
      }
    }
    for (const l of this.game.lines) this.rebuildLine(l);
    const farOp = smooth(0.25, 1.6, dist);
    for (const l of this.game.lines) {
      const lv = this.lineViews.get(l.id)!;
      const sel = selectedLine === l.id;
      const wpx = sel ? 7 : 5;
      lv.ribbonU.uHalf.value = wpx * 0.5 * pxWorld;
      lv.ribbonU.uLaneW.value = 6.4 * pxWorld;
      lv.ribbonU.uLift.value = dist * 0.0004 + 0.00006;
      lv.ribbonMat.opacity = Math.max(0.0, farOp);
      lv.ribbonMat.emissiveIntensity = sel ? 1.0 : 0.5 + this.night * 0.5;
      lv.ribbonMat.visible = farOp > 0.01;
      const showReal = dist < 14;
      for (const m of lv.real) m.visible = showReal;
    }
  }

  // ================= 车站 LOD =================
  syncStations(tx: number, tz: number, dist: number) {
    const near = dist < 12;
    let built = 0;
    for (const st of this.game.stations) {
      let sv = this.stationViews.get(st.id);
      const d = Math.hypot(st.x - tx, st.z - tz);
      const want = st.revealed && near && d < Math.max(1.2, dist * 1.7);
      if (!want) {
        if (sv && sv.group.visible) sv.group.visible = false;
        if (sv && (dist > 40 || d > 60)) {
          this.stationGroup.remove(sv.group);
          sv.dispose();
          this.stationViews.delete(st.id);
        }
        continue;
      }
      if (!sv) {
        if (built >= 2) continue;
        sv = new StationView(st, this.game, this.stationMats);
        this.stationViews.set(st.id, sv);
        this.stationGroup.add(sv.group);
        sv.build();
        built++;
      } else if (sv.sig !== sv.signature() && built < 2) {
        sv.build();
        built++;
      }
      sv.group.visible = true;
      sv.animate(this.time);
    }
  }

  // ================= 区域着色 =================
  updateRegionColors() {
    const g = this.game;
    const waitByCity = new Map<string, { w: number; n: number }>();
    for (const s of g.stations) {
      if (!s.revealed) continue;
      const e = waitByCity.get(s.cityId) ?? { w: 0, n: 0 };
      e.w += s.waiting.length;
      e.n++;
      waitByCity.set(s.cityId, e);
    }
    for (const [id, mat] of this.regionMats) {
      const city = g.cities.find((c) => c.id === id)!;
      const base = new THREE.Color(city.color);
      const c = this.tmpC;
      if (this.mode === 'political') {
        c.copy(base);
        if (!city.unlocked) c.lerp(new THREE.Color(0x7a7d80), 0.72).multiplyScalar(0.78);
      } else if (this.mode === 'terrain') {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 97;
        c.setHSL(0.22 + (h % 7) * 0.012, 0.32, 0.36 + (h % 5) * 0.015);
        if (!city.unlocked) c.multiplyScalar(0.72);
      } else {
        const e = waitByCity.get(id);
        if (!city.unlocked || !e) c.set(0x555a60);
        else {
          const v = Math.min(1, e.w / (e.n * 8));
          c.set(0x2f7f9a).lerp(new THREE.Color(0xf2c14e), Math.min(1, v * 2)).lerp(new THREE.Color(0xe0352b), Math.max(0, v * 2 - 1));
        }
      }
      c.lerp(this.neutralLand, (1 - smooth(1.5, 10, this.curDist)) * 0.72);
      mat.color.copy(c);
      mat.emissive.set(this.selectedRegion === id ? 0x2a2a38 : 0x000000);
    }
  }

  // ================= 每帧更新 =================
  update(opts: {
    dt: number;
    tx: number;
    tz: number;
    dist: number;
    pxWorld: number;
    selectedLine: number | null;
    camPos: THREE.Vector3;
  }) {
    const { dt, tx, tz, dist, pxWorld, selectedLine } = opts;
    this.time += dt;
    this.curDist = dist;
    const g = this.game;
    const h = g.clockHours;
    // 昼夜
    const el = Math.sin(((h - 6) / 12) * Math.PI);
    this.daylight = smooth(-0.1, 0.32, el);
    this.night = 1 - this.daylight;
    const az = ((h - 6) / 12) * Math.PI;
    const ea = Math.max(0.06, Math.asin(Math.max(0, el)) * 0.92 + 0.1);
    const sunDir = this.tmpV.set(-Math.cos(az) * Math.cos(ea), Math.sin(ea), 0.4 * Math.cos(ea)).normalize().clone();
    const storm = g.event?.kind === 'typhoon' ? 1 : 0;
    this.sun.color.setRGB(1, 0.62 + 0.34 * smooth(0, 0.6, el), 0.38 + 0.52 * smooth(0, 0.6, el));
    this.sun.intensity = 3.3 * this.daylight * (1 - 0.55 * storm);
    this.moon.intensity = 0.35 * this.night;
    this.hemi.intensity = 0.1 + 0.2 * this.daylight;
    this.scene.environmentIntensity = (0.1 + 0.9 * this.daylight) * (1 - 0.3 * storm);

    // 背景/雾
    const dayC = new THREE.Color(0xb7d0e6);
    const duskC = new THREE.Color(0xe7a67a);
    const nightC = new THREE.Color(0x070b16);
    const fc = this.fogColor;
    fc.copy(nightC).lerp(dayC, this.daylight);
    fc.lerp(duskC, smooth(0.4, 0, el) * smooth(-0.1, 0.1, el) * 0.8);
    if (storm) fc.lerp(new THREE.Color(0x56606a), 0.6 * this.daylight + 0.3);
    (this.scene.background as THREE.Color).copy(fc);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(fc);
    fog.near = dist * 1.2;
    fog.far = dist * 11;

    // 阴影跟随
    const size = Math.max(0.1, Math.min(6, dist * 0.8));
    this.shadowSize = size;
    this.sun.position.set(tx + sunDir.x * size * 4, sunDir.y * size * 4, tz + sunDir.z * size * 4);
    this.sun.target.position.set(tx, 0, tz);
    const cam = this.sun.shadow.camera;
    cam.left = -size;
    cam.right = size;
    cam.top = size;
    cam.bottom = -size;
    cam.near = size * 0.2;
    cam.far = size * 9;
    cam.updateProjectionMatrix();
    (this.sun.shadow as unknown as { intensity: number }).intensity = 1 - smooth(5, 14, dist);
    this.sun.castShadow = this.quality !== 'low' && dist < 14 && this.daylight > 0.02;

    // 海面
    const seaY = -Math.max(0.004, dist * 0.0009);
    this.sea.position.set(tx, seaY, tz);
    const fr = (v: number) => v - Math.floor(v);
    this.waterNormal.offset.set(fr(tx / 2.4 + this.time * 0.004), fr(-tz / 2.4 + this.time * 0.0027));
    (this.sea.material as THREE.MeshPhysicalMaterial).normalScale.setScalar(0.25 + 0.45 * (1 - smooth(20, 300, dist)));
    const seaDeep = new THREE.Color(0x136a8f).lerp(new THREE.Color(0x02080f), this.night * 0.9);
    this.seaMat.color.copy(seaDeep);

    // 边界线宽
    for (const u of this.borderU) {
      u.uPx.value = pxWorld;
      u.uLift.value = dist * 0.0003 + 0.00005;
      u.uOpacity.value = 0.65 * (1 - smooth(8, 40, dist) * 0.55);
    }
    for (const u of this.coastU) {
      u.uPx.value = pxWorld;
      u.uLift.value = dist * 0.0002;
    }

    // 建筑
    this.buildingMat.emissiveIntensity = this.night * 1.1;
    const showB = dist < 55;
    for (const c of this.buildingChunks) {
      const d = Math.hypot(c.x - tx, c.z - tz);
      c.mesh.visible = showB && d < Math.max(14, dist * 2.2);
    }
    this.landmarks.visible = dist < 400;
    for (const m of this.landmarkMats) m.emissiveIntensity = this.night * 1.2;
    this.stationMats.lamp.emissiveIntensity = 0.5 + this.night * 3;
    for (const m of this.stationMats.colorMats.values()) m.emissiveIntensity = 0.9 + this.night * 1.3;
    this.stationMats.escTex.offset.y -= dt * 0.8;
    this.carMats.glass.emissiveIntensity = 0.12 + this.night * 1.3;
    this.carMats.stripe.emissiveIntensity = 0.2 + this.night * 0.6;

    // 区域颜色
    if (this.time - this.lastRegionUpdate > (dist < 12 ? 0.15 : 0.5)) {
      this.lastRegionUpdate = this.time;
      this.updateRegionColors();
    }

    this.syncLines(selectedLine, pxWorld, dist);
    this.syncStations(tx, tz, dist);
    this.updateTrains(dist);
  }

  trainWorldPos(t: Train, out: { x: number; y: number; z: number; tx: number; tz: number }) {
    const line = this.game.lineOf(t.line);
    if (!line) return false;
    let s = t.s;
    if (line.loop) s = ((s % line.path.length) + line.path.length) % line.path.length;
    pathAt(line.path, s, out as PathSample);
    return true;
  }
}
