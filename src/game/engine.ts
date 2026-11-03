import { LINE_COLORS, LINE_NAMES, type Shape, type StationDef } from '../data/regions';
import { CITY_META } from '../data/cities';
import { project, waterProfile, type WaterKind } from './geo';
import { buildPath, VIADUCT_H, type PathData } from './path';
import { generateStations, hashStr } from './stationGen';

/** 开局城市：佛山 */
export const START_CITY = '440600';

export const SHAPE_LIST: Shape[] = ['circle', 'triangle', 'square', 'diamond', 'pentagon', 'cross', 'star'];

export interface Passenger {
  id: number;
  target: Shape;
  from: number;
  skipTrain: number;
}

export interface Station {
  id: number;
  name: string;
  cityId: string;
  lon: number;
  lat: number;
  x: number;
  z: number;
  tier: 1 | 2 | 3;
  shape: Shape;
  revealed: boolean;
  waiting: Passenger[];
  over: number;
  lineIds: number[];
  hub: boolean;
  order: number;
}

export interface Train {
  id: number;
  line: number;
  s: number;
  v: number;
  dir: 1 | -1;
  target: number;
  state: 'run' | 'dwell';
  dwell: number;
  pax: Passenger[];
  cars: number;
  lastStation: number;
}

export type BridgeKind = 'river' | 'jiang' | 'lake' | 'sea';
export interface BridgeInfo {
  kind: BridgeKind;
  name: string; // 跨河大桥 / 跨江大桥 / 跨海大桥
  a: number; // 车站 id
  b: number;
  km: number;
  t0: number; // 桥起点在线路参数上的比例
  t1: number;
}
export const BRIDGE_NAME: Record<BridgeKind, string> = { river: '跨河大桥', jiang: '跨江大桥', lake: '跨湖大桥', sea: '跨海大桥' };

export interface Line {
  id: number;
  slot: number;
  color: string;
  name: string;
  stations: number[];
  loop: boolean;
  path: PathData;
  invested: number;
  sig: string;
  bridges: BridgeInfo[];
}

export interface CityState {
  id: string;
  name: string;
  short: string;
  color: string;
  unlocked: boolean;
  cost: number;
  stationIds: number[];
  delivered: number;
}

export type TechKey = 'signal' | 'capacity' | 'tbm' | 'platform' | 'licence';
export interface TechDef {
  key: TechKey;
  name: string;
  desc: string;
  max: number;
  cost: (lv: number) => number;
}
export const TECHS: TechDef[] = [
  { key: 'signal', name: '信号系统升级', desc: '列车运行速度 +20%', max: 3, cost: (l) => 220 + l * 180 },
  { key: 'capacity', name: '大运量编组', desc: '每节车厢载客 +2', max: 3, cost: (l) => 260 + l * 200 },
  { key: 'tbm', name: '盾构 / 沉管技术', desc: '跨海隧道造价 -30%', max: 2, cost: (l) => 240 + l * 260 },
  { key: 'platform', name: '站台扩建', desc: '车站容量 +2', max: 3, cost: (l) => 200 + l * 220 },
  { key: 'licence', name: '新线路许可', desc: '可同时运营线路 +1', max: 5, cost: (l) => 180 + l * 160 },
];

export type EventKind = 'typhoon' | 'rush' | 'fair';
export interface GameEvent {
  kind: EventKind;
  left: number;
  total: number;
  title: string;
  desc: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

const DAY_LEN = 80; // 每“天”对应的游戏秒数
const SPEED_BASE = 2.4; // km/s
const ACC = 1.7;
const STOP_PENALTY = 4;

// ---------- 平衡参数（可用模拟回归调参） ----------
// 拥堵判定只作用于“已接入线网”的车站：未接入的车站玩家够不到，
// 让它也能导致失败会变成不可控的死局。
export const BAL = {
  startMoney: 650, // 起步资金
  baseCap: 12, // 站点基础候车容量
  hubCap: 6, // 换乘枢纽额外容量
  tier3Cap: 3, // 三级枢纽额外容量
  carCap: 6, // 每节车厢载客
  spawnBase: 0.025, // 客流生成基础速率
  growth: 0.025, // 每运营一天的客流增长
  overSecs: 60, // 超容多久判定运营中断
  unconnected: 0.5, // 未接入线网车站的客流增速系数
  backlog: 6, // 候车人数可超出容量的上限（超出后不再生成新乘客）
  trainCost: 60,
  carCost: 35,
};

export class Game {
  stations: Station[] = [];
  lines: Line[] = [];
  trains: Train[] = [];
  cities: CityState[] = [];
  money = BAL.startMoney;
  delivered = 0;
  time = (8 / 24) * DAY_LEN;
  speed = 1;
  over = false;
  overReason = '';
  techs: Record<TechKey, number> = { signal: 0, capacity: 0, tbm: 0, platform: 0, licence: 0 };
  event: GameEvent | null = null;
  toasts: Toast[] = [];
  netVersion = 1;
  pathVersion = 1;
  revealTimer = 14;
  nextEventAt = 3.2 * DAY_LEN;
  lastWeek = 0;
  income = 0;
  private nextId = 1;
  private adj = new Map<number, { to: number; line: number; w: number }[]>();
  private dist = new Map<Shape, Float64Array>();
  private distStamp = -1;
  private acc = 0;
  stationById = new Map<number, Station>();

  constructor(public seed = (Math.random() * 1e9) | 0) {
    const [sx, sz] = project(CITY_META.find((c) => c.id === START_CITY)!.lon, CITY_META.find((c) => c.id === START_CITY)!.lat);
    for (const c of CITY_META) {
      const [cx, cz] = project(c.lon, c.lat);
      const dist = Math.hypot(cx - sx, cz - sz);
      const divs = Math.max(1, Math.round(Math.sqrt(c.area) / 25));
      const cost = Math.max(60, Math.round((180 + 78 * Math.log2(1 + dist / 50) + divs * 6) / 10) * 10);
      this.cities.push({ id: c.id, name: c.name, short: c.short, color: c.color, unlocked: false, cost, stationIds: [], delivered: 0 });
    }
    const start = this.cities.find((c) => c.id === START_CITY)!;
    start.unlocked = true;
    this.addCityStations(START_CITY, 4);
    this.toast('佛山地铁规划获批！从站点拖拽即可铺设线路，广州等城市需资金解锁。', 'info');
  }

  /** 为一座城市程序化生成车站（解锁时调用，保证每局都不一样） */
  addCityStations(cityId: string, revealN = 3) {
    const city = this.cities.find((c) => c.id === cityId);
    if (!city) return;
    const defs: StationDef[] = generateStations((this.seed ^ hashStr(cityId)) >>> 0, cityId);
    defs.forEach((d, k) => {
      const id = this.stations.length;
      const [x, z] = project(d.lon, d.lat);
      const st: Station = {
        id, name: d.name, cityId, lon: d.lon, lat: d.lat, x, z, tier: d.tier,
        shape: d.shape ?? 'circle', revealed: k < revealN, waiting: [], over: 0, lineIds: [], hub: false, order: k,
      };
      this.stations.push(st);
      this.stationById.set(id, st);
      city.stationIds.push(id);
    });
    this.netVersion++;
  }

  // ---------- 辅助 ----------
  toast(text: string, kind: Toast['kind'] = 'info') {
    this.toasts.push({ id: this.nextId++, text, kind });
    if (this.toasts.length > 5) this.toasts.shift();
  }

  get clockHours() {
    return ((this.time % DAY_LEN) / DAY_LEN) * 24;
  }
  get day() {
    return Math.floor(this.time / DAY_LEN);
  }
  get maxLines() {
    return 3 + this.techs.licence;
  }
  carCap() {
    return BAL.carCap + this.techs.capacity * 2;
  }
  stationCap(s: Station) {
    return BAL.baseCap + (s.hub ? BAL.hubCap : 0) + this.techs.platform * 2 + (s.tier === 3 ? BAL.tier3Cap : 0);
  }
  trainSpeed() {
    let v = SPEED_BASE * (1 + this.techs.signal * 0.2);
    if (this.event?.kind === 'typhoon') v *= 0.55;
    return v;
  }
  revealed() {
    return this.stations.filter((s) => s.revealed);
  }
  lineOf(id: number) {
    return this.lines.find((l) => l.id === id);
  }
  linePassengers(l: Line) {
    return this.trains.filter((t) => t.line === l.id).reduce((a, t) => a + t.pax.length, 0);
  }
  /** 单段造价：陆地按里程，跨河 / 跨江 / 跨海按不同桥型加价；盾构科技只折跨海 */
  segCost(a: number, b: number) {
    const A = this.stations[a];
    const B = this.stations[b];
    const len = Math.hypot(A.x - B.x, A.z - B.z);
    const w = waterProfile(A.x, A.z, B.x, B.z);
    const land = Math.max(0, len - w.river - w.jiang - w.lake - w.sea);
    const seaRate = 4.2 * (1 - this.techs.tbm * 0.15);
    return Math.round(land * 0.85 + w.river * 1.7 + w.jiang * 2.6 + w.lake * 2.2 + w.sea * seaRate);
  }

  /** 该段的跨水明细（桥型 / 里程 / 跨度），供造价、桥体渲染与 UI 使用 */
  segWater(a: number, b: number): BridgeInfo | null {
    const A = this.stations[a];
    const B = this.stations[b];
    const w = waterProfile(A.x, A.z, B.x, B.z);
    const km = w.river + w.jiang + w.lake + w.sea;
    if (km < 0.35) return null;
    const kind: BridgeKind = w.kind === 'none' ? 'river' : (w.kind as WaterKind as BridgeKind);
    return { kind, name: BRIDGE_NAME[kind], a, b, km, t0: w.from, t1: w.to };
  }

  seaOf(a: number, b: number) {
    const A = this.stations[a];
    const B = this.stations[b];
    return waterProfile(A.x, A.z, B.x, B.z).sea;
  }
  spend(amount: number): boolean {
    if (this.money < amount) {
      this.toast(`资金不足，需要 ¥${amount}`, 'bad');
      return false;
    }
    this.money -= amount;
    return true;
  }

  // ---------- 线路操作 ----------
  freeSlot(): number {
    for (let i = 0; i < this.maxLines; i++) if (!this.lines.some((l) => l.slot === i)) return i;
    return -1;
  }

  createLine(a: number, b: number): Line | null {
    if (a === b) return null;
    const slot = this.freeSlot();
    if (slot < 0) {
      this.toast('线路数量已达上限，请在科技中申请新线路许可', 'bad');
      return null;
    }
    const cost = this.segCost(a, b);
    if (!this.spend(cost)) return null;
    const line: Line = {
      id: this.nextId++, slot, color: LINE_COLORS[slot], name: LINE_NAMES[slot], stations: [a, b], loop: false,
      path: null as unknown as PathData, invested: cost, sig: '', bridges: [],
    };
    this.lines.push(line);
    this.rebuild();
    this.spawnTrain(line, true);
    const br = this.segWater(a, b);
    this.toast(
      `${line.name} 开通：${this.stations[a].name} — ${this.stations[b].name}` + (br ? `（设${br.name} ${br.km.toFixed(0)}km）` : ''),
      'good',
    );
    return line;
  }

  extendCost(line: Line, end: 'head' | 'tail', sid: number) {
    const ref = end === 'tail' ? line.stations[line.stations.length - 1] : line.stations[0];
    return this.segCost(ref, sid);
  }

  extendLine(lineId: number, end: 'head' | 'tail', sid: number): boolean {
    const line = this.lineOf(lineId);
    if (!line || line.loop) return false;
    const n = line.stations.length;
    const other = end === 'tail' ? line.stations[0] : line.stations[n - 1];
    const makeLoop = sid === other && n >= 3;
    if (!makeLoop && line.stations.includes(sid)) return false;
    const ref = end === 'tail' ? line.stations[n - 1] : line.stations[0];
    if (ref === sid) return false;
    const cost = this.segCost(ref, sid);
    if (!this.spend(cost)) return false;
    line.invested += cost;
    if (makeLoop) line.loop = true;
    else if (end === 'tail') line.stations.push(sid);
    else line.stations.unshift(sid);
    this.rebuild();
    if (makeLoop) this.toast(`${line.name} 已成环线`, 'good');
    return true;
  }

  insertCost(line: Line, seg: number, sid: number) {
    const n = line.stations.length;
    const a = line.stations[seg];
    const b = line.stations[(seg + 1) % n];
    return Math.max(0, this.segCost(a, sid) + this.segCost(sid, b) - this.segCost(a, b));
  }

  insertStation(lineId: number, seg: number, sid: number): boolean {
    const line = this.lineOf(lineId);
    if (!line || line.stations.includes(sid)) return false;
    const cost = this.insertCost(line, seg, sid);
    if (!this.spend(cost)) return false;
    line.invested += cost;
    line.stations.splice(seg + 1, 0, sid);
    this.rebuild();
    this.toast(`${line.name} 已改道经过 ${this.stations[sid].name}`, 'good');
    return true;
  }

  removeStationFromLine(lineId: number, sid: number): boolean {
    const line = this.lineOf(lineId);
    if (!line) return false;
    if (line.stations.length <= 2) return false;
    const idx = line.stations.indexOf(sid);
    if (idx < 0) return false;
    line.stations.splice(idx, 1);
    if (line.stations.length < 3) line.loop = false;
    this.rebuild();
    this.toast(`${line.name} 已取消停靠 ${this.stations[sid].name}`, 'info');
    return true;
  }

  removeLine(lineId: number) {
    const line = this.lineOf(lineId);
    if (!line) return;
    const refund = Math.round(line.invested * 0.5) + this.trains.filter((t) => t.line === lineId).length * 30;
    this.money += refund;
    for (const t of this.trains.filter((t) => t.line === lineId)) {
      for (const p of t.pax) this.stations[t.lastStation].waiting.push(p);
    }
    this.trains = this.trains.filter((t) => t.line !== lineId);
    this.lines = this.lines.filter((l) => l.id !== lineId);
    this.rebuild();
    this.toast(`${line.name} 已拆除，回收 ¥${refund}`, 'info');
  }

  trainCost() {
    return BAL.trainCost;
  }
  carCost() {
    return BAL.carCost;
  }

  addTrain(lineId: number): boolean {
    const line = this.lineOf(lineId);
    if (!line) return false;
    if (this.trains.filter((t) => t.line === lineId).length >= 8) {
      this.toast('该线路列车已满', 'bad');
      return false;
    }
    if (!this.spend(this.trainCost())) return false;
    this.spawnTrain(line, false);
    return true;
  }

  addCar(lineId: number): boolean {
    const ts = this.trains.filter((t) => t.line === lineId && t.cars < 6).sort((a, b) => a.cars - b.cars);
    if (!ts.length) {
      this.toast('该线路列车已是最大编组（6节）', 'bad');
      return false;
    }
    if (!this.spend(this.carCost())) return false;
    ts[0].cars++;
    return true;
  }

  private spawnTrain(line: Line, first: boolean) {
    const ts = this.trains.filter((t) => t.line === line.id);
    const idx = first ? 0 : Math.min(line.stations.length - 1, ts.length % line.stations.length);
    const t: Train = {
      id: this.nextId++, line: line.id, s: line.path.stationS[idx], v: 0, dir: 1, target: 1, state: 'dwell', dwell: 0.6,
      pax: [], cars: 2, lastStation: line.stations[idx],
    };
    if (!line.loop && idx === line.stations.length - 1) {
      t.dir = -1;
      t.target = idx - 1;
    } else t.target = idx + 1;
    this.trains.push(t);
  }

  unlockCity(id: string): boolean {
    const c = this.cities.find((x) => x.id === id);
    if (!c || c.unlocked) return false;
    if (!this.spend(c.cost)) return false;
    c.unlocked = true;
    this.addCityStations(c.id, 3);
    this.rebuild();
    this.netVersion++;
    this.toast(`${c.short} 地铁规划获批，新站点开始出现！`, 'good');
    return true;
  }

  buyTech(key: TechKey): boolean {
    const t = TECHS.find((x) => x.key === key)!;
    const lv = this.techs[key];
    if (lv >= t.max) return false;
    if (!this.spend(t.cost(lv))) return false;
    this.techs[key]++;
    this.toast(`科技升级：${t.name} Lv.${this.techs[key]}`, 'good');
    return true;
  }

  // ---------- 网络重建 ----------
  rebuild() {
    // station line membership
    for (const s of this.stations) s.lineIds = [];
    for (const l of this.lines) for (const sid of l.stations) this.stations[sid].lineIds.push(l.id);
    for (const s of this.stations) {
      s.lineIds.sort((a, b) => a - b);
      s.hub = s.lineIds.length >= 2;
    }
    // edge lanes
    const edges = new Map<string, number[]>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    for (const l of this.lines) {
      const n = l.stations.length;
      const segs = l.loop ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const k = edgeKey(l.stations[i], l.stations[(i + 1) % n]);
        const arr = edges.get(k) ?? [];
        arr.push(l.id);
        edges.set(k, arr);
      }
    }
    for (const l of this.lines) {
      const n = l.stations.length;
      const segs = l.loop ? n : n - 1;
      const lanes: number[] = [];
      for (let i = 0; i < segs; i++) {
        const arr = edges.get(edgeKey(l.stations[i], l.stations[(i + 1) % n]))!;
        arr.sort((a, b) => a - b);
        const rank = arr.indexOf(l.id);
        let lane = rank - (arr.length - 1) / 2;
        // 方向相反时车道左右互换，保证并行线路不交叉
        if (l.stations[i] > l.stations[(i + 1) % n]) lane = -lane;
        lanes.push(lane);
      }
      const elev = l.stations.map((sid) => {
        const st = this.stations[sid];
        if (!st.hub) return VIADUCT_H;
        return VIADUCT_H + (st.lineIds.indexOf(l.id) + 1) * 0.006;
      });
      const old = l.sig;
      const oldPath = l.path;
      const bridges: BridgeInfo[] = [];
      const arch = Array.from({ length: Math.max(1, segs) }, () => ({ h: 0, t0: 0, t1: 0 }));
      for (let i = 0; i < segs; i++) {
        const bi = this.segWater(l.stations[i], l.stations[(i + 1) % n]);
        if (!bi) continue;
        bridges.push(bi);
        arch[i] = { h: bi.kind === 'sea' ? 0.05 : bi.kind === 'jiang' ? 0.028 : bi.kind === 'lake' ? 0.032 : 0.014, t0: bi.t0, t1: bi.t1 };
      }
      l.bridges = bridges;
      l.path = buildPath({ pts: l.stations.map((sid) => [this.stations[sid].x, this.stations[sid].z]), elev, lanes, loop: l.loop, arch });
      const sig = l.stations.join(',') + (l.loop ? 'L' : '');
      l.sig = sig;
      if (old !== sig) {
        const prefix = old && oldPath && sig.startsWith(old.replace('L', '')) && !l.loop && !old.endsWith('L');
        for (const t of this.trains.filter((t) => t.line === l.id)) {
          if (prefix && t.target < l.stations.length) continue;
          this.snapTrain(t, l);
        }
      }
    }
    this.netVersion++;
    this.pathVersion++;
    this.pruneUnroutable();
  }

  // 线网变动后，把“接上来的车站里已经送不掉”的乘客请下车：
  // 否则他们会永远上不了车，却一直占着站台把人堆到判负。
  private pruneUnroutable() {
    this.computeNet();
    let dropped = 0;
    for (const s of this.stations) {
      if (!s.lineIds.length || !s.waiting.length) continue;
      const keep = s.waiting.filter((p) => isFinite(this.dist.get(p.target)![s.id]));
      dropped += s.waiting.length - keep.length;
      s.waiting = keep;
    }
    if (dropped > 0) this.toast(`${dropped} 名乘客无法到达目的地，已改乘其他交通`, 'info');
  }

  private snapTrain(t: Train, l: Line) {
    let idx = l.stations.indexOf(t.lastStation);
    if (idx < 0) idx = 0;
    t.s = l.path.stationS[idx];
    t.v = 0;
    t.lastStation = l.stations[idx];
    t.state = 'dwell';
    t.dwell = 0.4;
    if (l.loop) {
      t.dir = 1;
      t.target = idx + 1;
    } else if (idx === l.stations.length - 1) {
      t.dir = -1;
      t.target = idx - 1;
    } else {
      t.dir = 1;
      t.target = idx + 1;
    }
  }

  // ---------- 路由 ----------
  private computeNet() {
    if (this.distStamp === this.netVersion) return;
    this.distStamp = this.netVersion;
    this.adj.clear();
    const add = (a: number, b: number, line: number) => {
      const A = this.stations[a];
      const B = this.stations[b];
      const w = Math.hypot(A.x - B.x, A.z - B.z) + STOP_PENALTY;
      const arr = this.adj.get(a) ?? [];
      arr.push({ to: b, line, w });
      this.adj.set(a, arr);
    };
    for (const l of this.lines) {
      const n = l.stations.length;
      const segs = l.loop ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = l.stations[i];
        const b = l.stations[(i + 1) % n];
        add(a, b, l.id);
        add(b, a, l.id);
      }
    }
    const N = this.stations.length;
    for (const sh of SHAPE_LIST) {
      const d = new Float64Array(N).fill(Infinity);
      const done = new Uint8Array(N);
      for (const s of this.stations) if (s.revealed && s.shape === sh) d[s.id] = 0;
      for (let it = 0; it < N; it++) {
        let u = -1;
        let best = Infinity;
        for (let i = 0; i < N; i++) if (!done[i] && d[i] < best) {
          best = d[i];
          u = i;
        }
        if (u < 0) break;
        done[u] = 1;
        for (const e of this.adj.get(u) ?? []) {
          if (d[u] + e.w < d[e.to]) d[e.to] = d[u] + e.w;
        }
      }
      this.dist.set(sh, d);
    }
  }

  nextHop(sid: number, target: Shape, preferLine?: number): { to: number; line: number } | null {
    this.computeNet();
    const d = this.dist.get(target)!;
    if (!isFinite(d[sid])) return null;
    let best: { to: number; line: number } | null = null;
    let bv = Infinity;
    for (const e of this.adj.get(sid) ?? []) {
      const v = e.w + d[e.to] - (e.line === preferLine ? 0.01 : 0);
      if (v < bv) {
        bv = v;
        best = { to: e.to, line: e.line };
      }
    }
    return best;
  }

  private hopLines(sid: number, to: number): number[] {
    return (this.adj.get(sid) ?? []).filter((e) => e.to === to).map((e) => e.line);
  }

  // ---------- 主循环 ----------
  update(realDt: number) {
    if (this.over || this.speed === 0) return;
    this.acc += Math.min(realDt, 0.1) * this.speed;
    const step = 1 / 30;
    let guard = 0;
    while (this.acc >= step && guard++ < 40) {
      this.acc -= step;
      this.step(step);
    }
  }

  private step(dt: number) {
    this.time += dt;
    this.computeNet();
    this.spawnPassengers(dt);
    this.updateTrains(dt);
    this.updateOvercrowd(dt);
    this.updateEvents(dt);
    this.updateReveal(dt);
    const wk = Math.floor(this.day / 7);
    if (wk > this.lastWeek) {
      this.lastWeek = wk;
      const bonus = 120 + this.cities.filter((c) => c.unlocked).length * 30;
      this.money += bonus;
      this.toast(`第 ${wk} 周结算：财政补贴 +¥${bonus}`, 'good');
    }
  }

  private spawnPassengers(dt: number) {
    const shapesAvail = new Set<Shape>();
    for (const s of this.stations) if (s.revealed) shapesAvail.add(s.shape);
    if (shapesAvail.size < 2) return;
    const hours = this.clockHours;
    const rush = (hours > 7 && hours < 9.5) || (hours > 17 && hours < 19.5) ? 1.5 : hours < 5.5 ? 0.35 : 1;
    let mult = rush * (1 + Math.min(this.day, 60) * BAL.growth);
    for (const s of this.stations) {
      if (!s.revealed) continue;
      let m = mult;
      if (this.event?.kind === 'rush') m *= 2.2;
      if (this.event?.kind === 'fair' && s.cityId === '440100') m *= 3.2;
      if (!s.lineIds.length) m *= BAL.unconnected; // 尚未接入线网的车站，客流增长放缓
      // 候车人数到顶后不再增长：积压站不会无限膨胀，
      // 玩家把线路接过来后还有疏导余地，而不是一接就判负。
      const maxBacklog = this.stationCap(s) + BAL.backlog;
      if (s.waiting.length >= maxBacklog) continue;
      const rate = BAL.spawnBase * (s.tier === 3 ? 1.5 : s.tier === 2 ? 1.15 : 0.9) * m;
      if (Math.random() < rate * dt) {
        // 已接线的车站只生成“从本站真的送得到”的形状：某形状若只落在未接线的车站上，
        // 发出去的乘客永远找不到路径、上不了车，会把车站白白堆到判负。
        // 未接线的车站仍按全部形状发客（车站有人气、也给玩家选址提示），
        // 它们接上线时会由 pruneUnroutable() 清掉送不掉的乘客。
        const choices = SHAPE_LIST.filter(
          (x) => shapesAvail.has(x) && x !== s.shape && (!s.lineIds.length || isFinite(this.dist.get(x)![s.id])),
        );
        if (!choices.length) continue;
        const weights = choices.map((x) => (x === 'star' ? 0.55 : 1));
        let r = Math.random() * weights.reduce((a, b) => a + b, 0);
        let target = choices[0];
        for (let i = 0; i < choices.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            target = choices[i];
            break;
          }
        }
        s.waiting.push({ id: this.nextId++, target, from: s.id, skipTrain: -1 });
      }
    }
  }

  private updateOvercrowd(dt: number) {
    for (const s of this.stations) {
      if (!s.revealed) continue;
      // 只有接入线网的车站才会因超容导致失败：未接入的车站玩家无从疏导
      if (s.lineIds.length && s.waiting.length > this.stationCap(s)) s.over += dt;
      else s.over = Math.max(0, s.over - dt * 2);
      if (s.over > BAL.overSecs) {
        this.over = true;
        this.overReason = `${s.name} 站严重拥堵，客流失控`;
        this.toast(this.overReason, 'bad');
      }
    }
  }

  private updateReveal(dt: number) {
    this.revealTimer -= dt;
    if (this.revealTimer > 0) return;
    this.revealTimer = 20 + Math.random() * 10;
    const cand = this.cities
      .filter((c) => c.unlocked && c.stationIds.some((id) => !this.stations[id].revealed))
      .sort((a, b) => a.stationIds.filter((i) => this.stations[i].revealed).length - b.stationIds.filter((i) => this.stations[i].revealed).length);
    if (!cand.length) return;
    const c = cand[Math.floor(Math.random() * Math.min(2, cand.length))];
    const sid = c.stationIds.find((id) => !this.stations[id].revealed)!;
    this.stations[sid].revealed = true;
    this.netVersion++;
    this.toast(`新站点开放：${c.short}·${this.stations[sid].name}`, 'info');
  }

  private updateEvents(dt: number) {
    if (this.event) {
      this.event.left -= dt;
      if (this.event.left <= 0) {
        this.toast(`${this.event.title}已结束`, 'info');
        this.event = null;
      }
      return;
    }
    if (this.time >= this.nextEventAt) {
      const kinds: GameEvent[] = [
        { kind: 'typhoon', left: 45, total: 45, title: '台风“海葵”登陆', desc: '全网列车限速 45%，注意疏导客流' },
        { kind: 'rush', left: 60, total: 60, title: '春运返乡大客流', desc: '所有车站客流 ×2.2' },
        { kind: 'fair', left: 55, total: 55, title: '广交会开幕', desc: '广州各站客流 ×3.2，客运票价 +50%' },
      ];
      this.event = kinds[Math.floor(Math.random() * kinds.length)];
      this.nextEventAt = this.time + (3 + Math.random() * 2.5) * DAY_LEN;
      this.toast(`${this.event.title}：${this.event.desc}`, 'bad');
    }
  }

  private fare(p: Passenger, at: Station) {
    const o = this.stations[p.from];
    const km = Math.hypot(o.x - at.x, o.z - at.z);
    let f = 2 + km * 0.14;
    if (this.event?.kind === 'fair') f *= 1.5;
    return Math.round(f);
  }

  private updateTrains(dt: number) {
    for (const t of this.trains) {
      const l = this.lineOf(t.line);
      if (!l) continue;
      if (t.state === 'dwell') {
        t.dwell -= dt;
        if (t.dwell <= 0) t.state = 'run';
        continue;
      }
      const stopS = l.path.stationS[t.target];
      const dStop = Math.abs(stopS - t.s);
      const vmax = this.trainSpeed();
      const vHere = Math.min(vmax, Math.sqrt(2 * ACC * dStop) + 0.12);
      if (t.v < vHere) t.v = Math.min(vHere, t.v + ACC * dt);
      else t.v = Math.max(vHere, t.v - ACC * 3 * dt);
      const adv = t.v * dt;
      if (adv >= dStop - 1e-4) {
        t.s = stopS;
        this.arrive(t, l);
      } else t.s += t.dir * adv;
    }
  }

  private arrive(t: Train, l: Line) {
    const n = l.stations.length;
    const k = t.target;
    const sid = l.stations[k % n];
    const st = this.stations[sid];
    t.lastStation = sid;
    t.v = 0;
    if (l.loop) {
      if (k === n) t.s = 0;
      t.dir = 1;
      t.target = (k % n) + 1;
    } else {
      if (k === 0) t.dir = 1;
      else if (k === n - 1) t.dir = -1;
      t.target = k + t.dir;
    }
    const nextSid = l.stations[t.target % n];
    let moved = 0;
    // 下车
    const stay: Passenger[] = [];
    for (const p of t.pax) {
      if (st.shape === p.target) {
        const f = this.fare(p, st);
        this.money += f;
        this.income += f;
        this.delivered++;
        const c = this.cities.find((c) => c.id === st.cityId);
        if (c) c.delivered++;
        moved++;
        continue;
      }
      const hop = this.nextHop(sid, p.target, l.id);
      if (hop && hop.to === nextSid && this.hopLines(sid, hop.to).includes(l.id)) stay.push(p);
      else if (!hop) {
        // 本站已无路可达其目的地（线网被改动过），直接下车离站，不留在站台堆积
        moved++;
      } else {
        p.skipTrain = t.id;
        st.waiting.push(p);
        moved++;
      }
    }
    t.pax = stay;
    // 上车
    const cap = t.cars * this.carCap();
    const remain: Passenger[] = [];
    for (const p of st.waiting) {
      if (t.pax.length < cap && p.skipTrain !== t.id) {
        const hop = this.nextHop(sid, p.target, l.id);
        if (hop && hop.to === nextSid && this.hopLines(sid, hop.to).includes(l.id)) {
          t.pax.push(p);
          moved++;
          continue;
        }
      }
      remain.push(p);
    }
    st.waiting = remain;
    t.state = 'dwell';
    t.dwell = 0.9 + Math.min(1.6, moved * 0.1);
  }
}
