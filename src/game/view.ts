import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { Game, Line } from './engine';
import { regionAt } from './geo';
import { makeIconAtlas, ICON, ICON_COLS } from './models';
import { pathAt, type PathSample } from './path';
import { project } from './project';
import { CITIES } from '../data/regions';
import { World, REGION_INFO, type MapMode, type Quality } from './world';
import type { Shape } from '../data/regions';

export type Sel = number | 'new' | null;

export interface ViewCallbacks {
  onTapStation(id: number | null): void;
  onTapRegion(id: string | null): void;
  onSelectLine(sel: Sel): void;
}

type Drag =
  | { kind: 'extend'; lineId: number; end: 'head' | 'tail'; from: number }
  | { kind: 'new'; from: number }
  | { kind: 'reroute'; lineId: number; seg: number }
  | { kind: 'remove'; lineId: number; from: number };

const FOV = 38;
const MIN_DIST = 0.045;
const MAX_DIST = 7600;   // 需覆盖全国约 4800 km 视野高度（dist 7000 时约 4821 km）

export function detectQuality(): Quality {
  const saved = localStorage.getItem('gd-metro-quality') as Quality | null;
  if (saved === 'low' || saved === 'mid' || saved === 'high') return saved;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(innerWidth, innerHeight) < 700;
  return mobile ? 'mid' : 'high';
}

export class GameView {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 60000);
  world: World;
  composer: EffectComposer | null = null;
  gtao: GTAOPass | null = null;
  bloom: UnrealBloomPass | null = null;
  overlay: HTMLCanvasElement;
  octx: CanvasRenderingContext2D;
  W = 1;
  H = 1;
  dpr = 1;
  // camera state
  tx = -10;
  tz = 25;
  dist = 70;
  yaw = 0;
  pitch = 1.0;
  follow: number | null = null;
  fly: { tx: number; tz: number; dist: number; t: number; from: { tx: number; tz: number; dist: number } } | null = null;
  vel = { x: 0, z: 0 };
  selected: Sel = null;
  selectedStation: number | null = null;
  hoverStation: number | null = null;
  private raf = 0;
  private last = performance.now();
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private pinch: { d: number; a: number; mx: number; my: number } | null = null;
  private drag: Drag | null = null;
  private cursor = { x: 0, y: 0 };
  private panning = false;
  private moved = 0;
  private downT = 0;
  private lastTap = 0;
  private rightDrag = false;
  private atlas: HTMLCanvasElement;
  private iconCache = new Map<string, HTMLCanvasElement>();
  private screenSt: { id: number; x: number; y: number; r: number }[] = [];
  private handles: { lineId: number; seg: number; x: number; y: number }[] = [];
  private rain: { x: number; y: number; v: number; l: number }[] = [];
  private v3 = new THREE.Vector3();
  private samp: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
  private tpos = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ro: ResizeObserver;
  private disposed = false;
  fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;

  constructor(public container: HTMLElement, public game: Game, public quality: Quality, private cb: ViewCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const cv = this.renderer.domElement;
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none;';
    container.appendChild(cv);
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    container.appendChild(this.overlay);
    this.octx = this.overlay.getContext('2d')!;
    this.world = new World(game, quality, this.renderer);
    this.atlas = makeIconAtlas().image as HTMLCanvasElement;
    for (let i = 0; i < 150; i++) this.rain.push({ x: Math.random(), y: Math.random(), v: 0.9 + Math.random() * 0.8, l: 10 + Math.random() * 18 });

    this.setupComposer();
    this.bindInput(cv);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------- 渲染管线 ----------------
  private setupComposer() {
    const q = this.quality;
    if (q === 'low') return;
    const rt = new THREE.WebGLRenderTarget(this.W, this.H, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 2 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.world.scene, this.camera));
    if (q === 'high') {
      this.gtao = new GTAOPass(this.world.scene, this.camera, this.W, this.H);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.9;
      this.composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.W, this.H), 0.32, 0.55, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setMode(m: MapMode) {
    this.world.mode = m;
    this.world.lastRegionUpdate = -10;
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    const maxDpr = this.quality === 'high' ? 2 : this.quality === 'mid' ? 1.5 : 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
    this.overlay.width = Math.round(this.W * this.dpr);
    this.overlay.height = Math.round(this.H * this.dpr);
    if (this.composer) {
      this.composer.setPixelRatio(this.dpr);
      this.composer.setSize(this.W, this.H);
    }
    this.iconCache.clear();
  }

  // ---------------- 相机 ----------------
  private applyCamera() {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    this.camera.position.set(this.tx + Math.sin(this.yaw) * cp * this.dist, sp * this.dist, this.tz + Math.cos(this.yaw) * cp * this.dist);
    this.camera.near = Math.max(0.0002, this.dist * 0.02);
    this.camera.far = this.dist * 90 + 50;
    this.camera.lookAt(this.tx, 0, this.tz);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  get pxWorld() {
    return (this.dist * 2 * Math.tan((FOV * Math.PI) / 360)) / this.H;
  }

  zoomBy(f: number) {
    this.fly = null;
    this.zoomAt(f, this.W / 2, this.H / 2);
  }

  setCamera(x: number, z: number, dist: number) {
    this.tx = x;
    this.tz = z;
    this.dist = dist;
  }

  focusProvince() {
    // 开局视野：聚焦起始城市（佛山）所在的珠三角。
    // 全国地图是「可探索范围」，不是开场视角 —— 一上来拉到全国尺度，
    // 站点、高架、站棚全被压成一个点，原版的细节全看不见。
    const start = CITIES.find((c) => c.startUnlocked);
    const st = start?.stations?.[0];
    let fx = 0;
    let fz = 0;
    if (st) {
      const [x, z] = project(st.lon, st.lat);
      fx = x;
      fz = z;
    }
    const aspect = this.W / this.H;
    // 约 55 km 视野高度：能看清站棚拱肋、高架箱梁与桥下路网
    const d = Math.max(28, Math.min(MAX_DIST, Math.max(70 / (0.69 * aspect), 55 / 0.69) * 0.95));
    this.follow = null;
    this.pitch = 1.0;
    this.yaw = 0;
    this.flyTo(fx, fz, d);
  }

  flyTo(x: number, z: number, dist: number) {
    this.fly = { tx: x, tz: z, dist, t: 0, from: { tx: this.tx, tz: this.tz, dist: this.dist } };
  }

  private groundAt(sx: number, sy: number): THREE.Vector3 | null {
    this.ray.setFromCamera(new THREE.Vector2((sx / this.W) * 2 - 1, -(sy / this.H) * 2 + 1), this.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  private zoomAt(factor: number, sx: number, sy: number) {
    const before = this.groundAt(sx, sy);
    this.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.dist * factor));
    this.applyCamera();
    const after = this.groundAt(sx, sy);
    if (before && after) {
      this.tx += before.x - after.x;
      this.tz += before.z - after.z;
      this.applyCamera();
    }
  }

  private panBy(dx: number, dy: number) {
    const pw = this.pxWorld;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const k = pw / Math.max(0.4, Math.sin(this.pitch));
    const mx = -rx * dx * pw + fx * dy * k;
    const mz = -rz * dx * pw + fz * dy * k;
    this.tx += mx;
    this.tz += mz;
    this.vel.x = mx;
    this.vel.z = mz;
  }

  // ---------------- 投影 ----------------
  private proj(x: number, y: number, z: number): { x: number; y: number; ok: boolean } {
    const v = this.v3.set(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.W, y: (-v.y * 0.5 + 0.5) * this.H, ok: v.z < 1 && v.z > -1 };
  }

  private stationLift(sid: number) {
    const st = this.game.stations[sid];
    return Math.min(0.06, this.dist * 0.035) + (st.hub ? st.lineIds.length * 0.009 : 0);
  }

  // ---------------- 输入 ----------------
  private bindInput(cv: HTMLCanvasElement) {
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    cv.addEventListener('pointermove', (e) => this.onMove(e));
    const up = (e: PointerEvent) => this.onUp(e);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.fly = null;
      this.zoomAt(Math.exp(e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  private local(e: PointerEvent) {
    const r = this.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitStation(x: number, y: number, exclude = -1): number | null {
    let best: number | null = null;
    let bd = 1e9;
    for (const s of this.screenSt) {
      if (s.id === exclude) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < s.r && d < bd) {
        bd = d;
        best = s.id;
      }
    }
    return best;
  }

  private hitLine(x: number, y: number): Line | null {
    let best: Line | null = null;
    let bd = 16;
    for (const l of this.game.lines) {
      const p = l.path;
      const step = Math.max(1, Math.floor(p.n / 700));
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i < p.n; i += step) {
        const q = this.proj(p.px[i], p.py[i], p.pz[i]);
        if (prev) {
          const dx = q.x - prev.x;
          const dy = q.y - prev.y;
          const l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((x - prev.x) * dx + (y - prev.y) * dy) / l2));
          const d = Math.hypot(prev.x + dx * t - x, prev.y + dy * t - y);
          if (d < bd) {
            bd = d;
            best = l;
          }
        }
        prev = q;
      }
    }
    return best;
  }

  private onDown(e: PointerEvent) {
    const p = this.local(e);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
    this.fly = null;
    this.follow = null;
    this.vel.x = this.vel.z = 0;
    this.cursor = p;
    if (this.pointers.size === 1) {
      this.moved = 0;
      this.downT = performance.now();
      this.rightDrag = e.button === 2 || (e.pointerType === 'mouse' && e.button === 1);
      this.drag = null;
      this.panning = false;
      if (!this.rightDrag) this.beginDrag(p.x, p.y);
      if (!this.drag && !this.rightDrag) this.panning = true;
    } else if (this.pointers.size === 2) {
      this.drag = null;
      this.panning = false;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }

  private beginDrag(x: number, y: number) {
    const g = this.game;
    // 1. 选中线路的改道把手
    if (typeof this.selected === 'number') {
      for (const h of this.handles) {
        if (h.lineId === this.selected && Math.hypot(h.x - x, h.y - y) < 20) {
          this.drag = { kind: 'reroute', lineId: h.lineId, seg: h.seg };
          return;
        }
      }
    }
    const sid = this.hitStation(x, y);
    if (sid === null) return;
    const st = g.stations[sid];
    const sel = this.selected;
    const newLine = () => {
      if (g.freeSlot() < 0) {
        g.toast('线路数量已达上限，请在科技中申请新线路许可', 'bad');
        return;
      }
      this.drag = { kind: 'new', from: sid };
    };
    if (typeof sel === 'number') {
      const line = g.lineOf(sel);
      if (line) {
        const idx = line.stations.indexOf(sid);
        const n = line.stations.length;
        if (idx >= 0) {
          if (!line.loop && (idx === 0 || idx === n - 1)) this.drag = { kind: 'extend', lineId: line.id, end: idx === 0 ? 'head' : 'tail', from: sid };
          else if (n > 2) this.drag = { kind: 'remove', lineId: line.id, from: sid };
          return;
        }
      }
      newLine();
      return;
    }
    if (sel === 'new') {
      newLine();
      return;
    }
    for (const lid of st.lineIds) {
      const line = g.lineOf(lid);
      if (!line || line.loop) continue;
      const idx = line.stations.indexOf(sid);
      const n = line.stations.length;
      if (idx === 0 || idx === n - 1) {
        this.drag = { kind: 'extend', lineId: lid, end: idx === 0 ? 'head' : 'tail', from: sid };
        return;
      }
    }
    newLine();
  }

  private onMove(e: PointerEvent) {
    const pt = this.pointers.get(e.pointerId);
    const p = this.local(e);
    this.cursor = p;
    if (!pt) return;
    const dx = p.x - pt.x;
    const dy = p.y - pt.y;
    pt.x = p.x;
    pt.y = p.y;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (this.pinch.d > 10) this.zoomAt(this.pinch.d / Math.max(10, d), mx, my);
      let da = ang - this.pinch.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.yaw -= da;
      this.pitch = Math.max(0.14, Math.min(1.5, this.pitch + (my - this.pinch.my) * 0.004));
      this.panBy(mx - this.pinch.mx, 0);
      this.pinch = { d, a: ang, mx, my };
      return;
    }
    if (this.rightDrag) {
      this.yaw -= dx * 0.006;
      this.pitch = Math.max(0.14, Math.min(1.5, this.pitch + dy * 0.004));
      return;
    }
    if (this.drag) {
      this.hoverStation = this.hitStation(p.x, p.y, 'from' in this.drag ? this.drag.from : -1);
      return;
    }
    if (this.panning) this.panBy(dx, dy);
  }

  private onUp(e: PointerEvent) {
    const pt = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!pt) return;
    const p = this.local(e);
    const g = this.game;
    const wasTap = this.moved < 10 && performance.now() - this.downT < 450;
    if (this.drag) {
      const d = this.drag;
      const hover = this.hitStation(p.x, p.y, 'from' in d ? d.from : -1);
      this.drag = null;
      this.hoverStation = null;
      if (wasTap && 'from' in d) {
        this.cb.onTapStation(d.from);
        return;
      }
      if (d.kind === 'extend') {
        if (hover !== null && g.extendLine(d.lineId, d.end, hover)) this.cb.onSelectLine(d.lineId);
      } else if (d.kind === 'new') {
        if (hover !== null) {
          const line = g.createLine(d.from, hover);
          if (line) this.cb.onSelectLine(line.id);
        }
      } else if (d.kind === 'reroute') {
        if (hover !== null) g.insertStation(d.lineId, d.seg, hover);
      } else if (d.kind === 'remove') {
        const s = this.screenSt.find((x) => x.id === d.from);
        if (hover === null && s && Math.hypot(s.x - p.x, s.y - p.y) > 60) g.removeStationFromLine(d.lineId, d.from);
      }
      return;
    }
    if (this.rightDrag) {
      this.rightDrag = false;
      return;
    }
    if (wasTap && this.pointers.size === 0) {
      const now = performance.now();
      if (now - this.lastTap < 320) {
        const gp = this.groundAt(p.x, p.y);
        if (gp) this.flyTo(gp.x, gp.z, Math.max(MIN_DIST * 2, this.dist * 0.4));
        this.lastTap = 0;
        return;
      }
      this.lastTap = now;
      const sid = this.hitStation(p.x, p.y);
      if (sid !== null) {
        this.cb.onTapStation(sid);
        return;
      }
      const l = this.hitLine(p.x, p.y);
      if (l) {
        this.cb.onSelectLine(l.id);
        return;
      }
      const gp = this.groundAt(p.x, p.y);
      if (gp) {
        const rid = regionAt(gp.x, gp.z);
        this.cb.onTapRegion(rid);
        return;
      }
      this.cb.onTapRegion(null);
    }
    this.panning = false;
  }

  // ---------------- 图标缓存 ----------------
  private icon(idx: number, color: string, px: number): HTMLCanvasElement {
    const key = `${idx}|${color}|${px}`;
    let c = this.iconCache.get(key);
    if (c) return c;
    const S = Math.max(4, Math.ceil(px * this.dpr));
    c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const sx = (idx % ICON_COLS) * 128;
    const sy = Math.floor(idx / ICON_COLS) * 128;
    g.drawImage(this.atlas, sx, sy, 128, 128, 0, 0, S, S);
    if (color !== '#fff') {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = color;
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(this.atlas, sx, sy, 128, 128, 0, 0, S, S);
    }
    this.iconCache.set(key, c);
    return c;
  }

  private drawIcon(idx: number, color: string, x: number, y: number, px: number) {
    const c = this.icon(idx, color, Math.round(px));
    this.octx.drawImage(c, x - px / 2, y - px / 2, px, px);
  }

  // ---------------- 叠加层 ----------------
  private drawOverlay(time: number) {
    const g = this.octx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const game = this.game;
    const dist = this.dist;
    const pw = this.pxWorld;

    // --- 区域名称（P 社大战略风格） ---
    // 关键：字号必须由「屏幕上的实际宽度」反推，且上限收紧。
    // 原来上限 54px 且按世界尺寸算，全国视野下每个省名都顶到最大字号，
    // 直接把地图糊满——这是"乱七八糟"观感的主要来源。
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const labelScale = Math.max(0.35, Math.min(1, 220 / Math.max(1, dist)));
    for (const r of REGION_INFO) {
      const chars = r.short.length;
      // r.size 是世界公里；pw 是每像素多少公里 → 屏幕宽度
      const screenW = (r.size * 0.62) / pw;
      let fs = (screenW / Math.max(2, chars)) * labelScale;
      fs = Math.min(fs, 40);
      if (fs < 10) continue;
      // 视野离开该省太远就不画标签
      if (Math.abs(r.x - this.tx) > dist * 3 || Math.abs(r.z - this.tz) > dist * 3) continue;
      const alphaFar = Math.min(1, (fs - 11) / 8);
      const p = this.proj(r.x, 0, r.z);
      if (!p.ok || p.x < -100 || p.x > this.W + 100 || p.y < -50 || p.y > this.H + 50) continue;
      const city = game.cities.find((c) => c.id === r.id);
      const locked = city && !city.unlocked;
      fs = Math.max(11, fs);
      g.font = `700 ${fs}px "Songti SC","Noto Serif CJK SC","STSong","SimSun",serif`;
      const sp = fs * 0.35;
      const total = chars * fs + (chars - 1) * sp;
      let x = p.x - total / 2 + fs / 2;
      const alpha = alphaFar * (dist < 6 ? Math.max(0, (dist - 2) / 4) : 1) * (locked ? 0.7 : 0.95);
      if (alpha <= 0.02) continue;
      g.globalAlpha = alpha;
      g.lineJoin = 'round';
      g.lineWidth = Math.max(2, fs * 0.14);
      g.strokeStyle = 'rgba(30,20,8,0.85)';
      g.fillStyle = locked ? '#cfcabd' : '#fff4d6';
      for (const ch of r.short) {
        g.strokeText(ch, x, p.y);
        g.fillText(ch, x, p.y);
        x += fs + sp;
      }
      if (locked && city && fs > 16) {
        g.font = `600 ${Math.max(10, fs * 0.34)}px system-ui,sans-serif`;
        g.lineWidth = 3;
        g.strokeText(`🔒 ¥${city.cost}`, p.x, p.y + fs * 0.85);
        g.fillStyle = '#ffd54f';
        g.fillText(`🔒 ¥${city.cost}`, p.x, p.y + fs * 0.85);
      }
      g.globalAlpha = 1;
    }

    // --- 选中线路的把手 ---
    this.handles = [];
    const selLine = typeof this.selected === 'number' ? game.lineOf(this.selected) : null;

    // --- 车站 ---
    this.screenSt = [];
    const showAllNames = dist < 40;
    const far = Math.max(0.42, 1 - Math.max(0, dist - 90) / 520);
    const showPax = dist < 260;
    for (const st of game.stations) {
      if (!st.revealed) continue;
      const lift = this.stationLift(st.id);
      const p = this.proj(st.x, lift, st.z);
      if (!p.ok || p.x < -80 || p.x > this.W + 80 || p.y < -80 || p.y > this.H + 80) continue;
      const base = (st.tier === 3 ? 30 : st.tier === 2 ? 26 : 23) * far;
      const px = base + (st.hub ? 4 * far : 0);
      this.screenSt.push({ id: st.id, x: p.x, y: p.y, r: Math.max(22, px * 0.9) });
      const cap = game.stationCap(st);
      const sel = this.selectedStation === st.id || this.hoverStation === st.id;
      const sc = sel ? 1.18 : 1;
      // 换乘枢纽外环
      if (st.hub) {
        g.beginPath();
        g.arc(p.x, p.y, px * 0.78 * sc, 0, Math.PI * 2);
        g.lineWidth = 2.5 * far + 0.5;
        g.strokeStyle = '#111';
        g.fillStyle = 'rgba(255,255,255,0.92)';
        g.fill();
        g.stroke();
      }
      this.drawIcon(ICON[st.shape], '#fff', p.x, p.y, px * sc * (st.hub ? 0.8 : 1));
      // 拥堵倒计时环
      const ratio = st.waiting.length / cap;
      if (st.over > 0.1) {
        const frac = Math.min(1, st.over / 45);
        g.beginPath();
        g.arc(p.x, p.y, px * 0.88, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        g.lineWidth = 4;
        g.strokeStyle = frac > 0.6 && Math.floor(time * 4) % 2 === 0 ? '#ff1744' : '#ff5252';
        g.stroke();
      } else if (ratio > 0.66) {
        g.beginPath();
        g.arc(p.x, p.y, px * 0.88, 0, Math.PI * 2);
        g.lineWidth = 2.5;
        g.strokeStyle = 'rgba(255,193,7,0.9)';
        g.stroke();
      }
      // 候车乘客
      const n = showPax ? Math.min(st.waiting.length, 18) : 0;
      for (let i = 0; i < n; i++) {
        const col = i % 6;
        const row = Math.floor(i / 6);
        this.drawIcon(ICON[st.waiting[i].target], '#ffffff', p.x + px * 0.75 + col * 11 * far + 6, p.y - 6 + row * 12 * far, 11 * far);
      }
      // 名称
      if (showAllNames || (dist < 160 && st.tier >= 2) || sel || (dist < 400 && st.tier === 3 && st.order === 0)) {
        g.font = `600 ${st.tier === 3 ? 12 : 11}px system-ui,"PingFang SC","Noto Sans CJK SC",sans-serif`;
        g.lineWidth = 3.5;
        g.strokeStyle = 'rgba(15,20,28,0.85)';
        g.fillStyle = '#f5f7fa';
        g.textAlign = 'center';
        g.strokeText(st.name, p.x, p.y + px * 0.5 + 12);
        g.fillText(st.name, p.x, p.y + px * 0.5 + 12);
      }
    }

    // --- 线路把手 ---
    if (selLine) {
      const n = selLine.stations.length;
      const segs = selLine.loop ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const s = (selLine.path.stationS[i] + selLine.path.stationS[i + 1]) / 2;
        pathAt(selLine.path, s, this.samp);
        const p = this.proj(this.samp.x, this.samp.y + dist * 0.0006, this.samp.z);
        if (!p.ok) continue;
        this.handles.push({ lineId: selLine.id, seg: i, x: p.x, y: p.y });
        g.beginPath();
        g.arc(p.x, p.y, 9, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = selLine.color;
        g.stroke();
        g.fillStyle = '#222';
        g.fillRect(p.x - 4, p.y - 1, 8, 2);
        g.fillRect(p.x - 1, p.y - 4, 2, 8);
      }
      if (!selLine.loop) {
        for (const idx of [0, n - 1]) {
          const sc = this.screenSt.find((s) => s.id === selLine.stations[idx]);
          if (!sc) continue;
          g.beginPath();
          g.arc(sc.x, sc.y, 22 + Math.sin(time * 5) * 1.5, 0, Math.PI * 2);
          g.setLineDash([5, 5]);
          g.lineWidth = 2.5;
          g.strokeStyle = selLine.color;
          g.stroke();
          g.setLineDash([]);
        }
      }
    }

    // --- 列车标记 + 载客 ---
    for (const t of game.trains) {
      const line = game.lineOf(t.line);
      if (!line) continue;
      this.world.trainWorldPos(t, this.tpos);
      const p = this.proj(this.tpos.x, this.tpos.y + Math.min(0.03, dist * 0.012), this.tpos.z);
      if (!p.ok || p.x < -40 || p.x > this.W + 40 || p.y < -40 || p.y > this.H + 40) continue;
      const cap = t.cars * game.carCap();
      if (dist > 14) {
        g.save();
        g.translate(p.x, p.y);
        g.beginPath();
        g.roundRect(-11, -7, 22, 14, 6);
        g.fillStyle = line.color;
        g.fill();
        g.lineWidth = 2.2;
        g.strokeStyle = '#fff';
        g.stroke();
        g.fillStyle = '#fff';
        g.font = '700 9px system-ui,sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(t.pax.length), 0, 0.5);
        g.restore();
      }
      // 载客率条
      const bw = 26;
      const by = p.y - (dist > 14 ? 13 : 10);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(p.x - bw / 2, by, bw, 3.5);
      g.fillStyle = t.pax.length >= cap ? '#ff5252' : line.color;
      g.fillRect(p.x - bw / 2, by, (bw * Math.min(t.pax.length, cap)) / cap, 3.5);
      if (dist < 60) {
        const n = Math.min(t.pax.length, 10);
        for (let i = 0; i < n; i++) this.drawIcon(ICON[t.pax[i].target], '#ffffff', p.x - (n * 9) / 2 + i * 9 + 4.5, by - 7, 9);
      }
    }

    // --- 拖拽预览 ---
    if (this.drag) this.drawPreview(this.drag);

    // --- 降雨（台风事件） ---
    if (game.event?.kind === 'typhoon') {
      g.strokeStyle = 'rgba(200,220,255,0.35)';
      g.lineWidth = 1.2;
      g.beginPath();
      for (const r of this.rain) {
        r.y += (r.v * 0.016 * 60) / this.H * 14;
        r.x -= 0.0016;
        if (r.y > 1.05) {
          r.y = -0.05;
          r.x = Math.random() * 1.2;
        }
        const x = r.x * this.W;
        const y = r.y * this.H;
        g.moveTo(x, y);
        g.lineTo(x - r.l * 0.35, y + r.l);
      }
      g.stroke();
    }
  }

  private drawPreview(d: Drag) {
    const g = this.octx;
    const game = this.game;
    const line = 'lineId' in d ? game.lineOf(d.lineId) : null;
    let color = '#ffffff';
    if (d.kind === 'new') color = '#ffffff';
    else if (line) color = line.color;
    if (d.kind === 'new') {
      const slot = game.freeSlot();
      if (slot >= 0) color = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#ec407a'][slot];
    }
    const cur = this.cursor;
    const hs = this.hoverStation;
    let tx = cur.x;
    let ty = cur.y;
    if (hs !== null) {
      const s = this.screenSt.find((x) => x.id === hs);
      if (s) {
        tx = s.x;
        ty = s.y;
      }
    }
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.setLineDash([2, 10]);
    g.lineWidth = 7;
    g.strokeStyle = color;
    g.globalAlpha = 0.9;
    let cost = 0;
    let ok = true;
    const drawFrom = (sid: number) => this.screenSt.find((x) => x.id === sid);
    if (d.kind === 'remove') {
      const s = drawFrom(d.from);
      if (s) {
        g.setLineDash([6, 6]);
        g.strokeStyle = '#ff5252';
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(cur.x, cur.y);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = '#ff5252';
        g.font = '700 13px system-ui,sans-serif';
        g.fillText('拖离以取消停靠', cur.x + 16, cur.y - 14);
      }
      g.restore();
      return;
    }
    g.beginPath();
    if (d.kind === 'reroute' && line) {
      const n = line.stations.length;
      const a = drawFrom(line.stations[d.seg]);
      const b = drawFrom(line.stations[(d.seg + 1) % n]);
      if (a && b) {
        g.moveTo(a.x, a.y);
        g.lineTo(tx, ty);
        g.lineTo(b.x, b.y);
      }
      if (hs !== null && !line.stations.includes(hs)) cost = game.insertCost(line, d.seg, hs);
      else if (hs !== null) ok = false;
    } else if (d.kind !== 'reroute') {
      const s = drawFrom(d.from);
      if (s) {
        g.moveTo(s.x, s.y);
        g.lineTo(tx, ty);
      }
      if (hs !== null) {
        if (d.kind === 'extend' && line) {
          if (line.stations.includes(hs) && !(line.stations.length >= 3 && hs === (d.end === 'tail' ? line.stations[0] : line.stations[line.stations.length - 1]))) ok = false;
          else cost = game.extendCost(line, d.end, hs);
        } else cost = game.segCost(d.from, hs);
      }
    }
    g.stroke();
    g.setLineDash([]);
    if (hs !== null) {
      const afford = game.money >= cost;
      const sea = d.kind === 'new' || d.kind === 'extend' ? game.seaOf(d.from, hs) : 0;
      g.font = '700 14px system-ui,sans-serif';
      g.textAlign = 'left';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      const label = !ok ? '无法连接' : `¥${cost}${sea > 1 ? ` · 跨海 ${sea.toFixed(0)}km` : ''}`;
      g.strokeText(label, tx + 22, ty - 22);
      g.fillStyle = !ok || !afford ? '#ff6e6e' : '#9cff9c';
      g.fillText(label, tx + 22, ty - 22);
      g.beginPath();
      g.arc(tx, ty, 26, 0, Math.PI * 2);
      g.lineWidth = 3;
      g.strokeStyle = !ok || !afford ? '#ff6e6e' : '#fff';
      g.stroke();
    }
    g.restore();
  }

  // ---------------- 主循环 ----------------
  private loop(now: number) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 1) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    this.game.update(dt);

    if (this.follow !== null) {
      const t = this.game.trains.find((x) => x.id === this.follow);
      if (t && this.world.trainWorldPos(t, this.tpos)) {
        this.tx += (this.tpos.x - this.tx) * Math.min(1, dt * 6);
        this.tz += (this.tpos.z - this.tz) * Math.min(1, dt * 6);
        this.dist += (0.1 - this.dist) * Math.min(1, dt * 2);
      } else this.follow = null;
    } else if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / 0.9);
      const k = 1 - Math.pow(1 - this.fly.t, 3);
      const f = this.fly.from;
      this.tx = f.tx + (this.fly.tx - f.tx) * k;
      this.tz = f.tz + (this.fly.tz - f.tz) * k;
      this.dist = Math.exp(Math.log(f.dist) + (Math.log(this.fly.dist) - Math.log(f.dist)) * k);
      if (this.fly.t >= 1) this.fly = null;
    } else if (!this.panning && this.pointers.size === 0 && (Math.abs(this.vel.x) + Math.abs(this.vel.z)) > 1e-7 * this.dist) {
      this.tx += this.vel.x;
      this.tz += this.vel.z;
      this.vel.x *= 0.92;
      this.vel.z *= 0.92;
    }
    this.pitch = Math.max(0.14, Math.min(1.5, this.pitch));
    this.applyCamera();

    this.world.selectedRegion = null;
    this.world.update({
      dt,
      tx: this.tx,
      tz: this.tz,
      dist: this.dist,
      pxWorld: this.pxWorld,
      selectedLine: typeof this.selected === 'number' ? this.selected : null,
      camPos: this.camera.position,
    });

    if (this.gtao) {
      this.gtao.enabled = this.dist < 20;
      if (this.gtao.enabled) this.gtao.updateGtaoMaterial({ radius: Math.max(0.0015, this.dist * 0.012), distanceExponent: 1.5, thickness: 2, scale: 1.0, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    }
    if (this.bloom) this.bloom.strength = 0.22 + this.world.night * 0.45;

    if (this.composer) this.composer.render();
    else this.renderer.render(this.world.scene, this.camera);

    this.drawOverlay(now / 1000);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}

export type { Shape };
