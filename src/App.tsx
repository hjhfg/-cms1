import { useEffect, useMemo, useRef, useState } from 'react';
import { BAL, Game, SHAPE_LIST, TECHS } from './game/engine';
import { GameView, detectQuality, type Sel } from './game/view';
import { project } from './game/geo';
import type { MapMode, Quality } from './game/world';
import type { Shape } from './data/regions';

type Panel = null | { type: 'station'; id: number } | { type: 'city'; id: string } | { type: 'tech' } | { type: 'help' } | { type: 'settings' };

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function fmtDate(day: number, hours: number) {
  const d = new Date(2026, 0, 5 + day);
  const hh = Math.floor(hours);
  const mm = Math.floor((hours - hh) * 60);
  return {
    date: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`,
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
  };
}

function ShapeIcon({ shape, size = 18, color = '#fff' }: { shape: Shape; size?: number; color?: string }) {
  const common = { fill: color, stroke: '#111', strokeWidth: 2, strokeLinejoin: 'round' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="inline-block shrink-0">
      {shape === 'circle' && <circle cx="12" cy="12" r="9" {...common} />}
      {shape === 'triangle' && <polygon points="12,3 22,21 2,21" {...common} />}
      {shape === 'square' && <rect x="4" y="4" width="16" height="16" rx="2" {...common} />}
      {shape === 'diamond' && <polygon points="12,1.5 22.5,12 12,22.5 1.5,12" {...common} />}
      {shape === 'pentagon' && <polygon points="12,2 22,9.5 18.3,21 5.7,21 2,9.5" {...common} />}
      {shape === 'cross' && <polygon points="9,2 15,2 15,9 22,9 22,15 15,15 15,22 9,22 9,15 2,15 2,9 9,9" {...common} />}
      {shape === 'star' && <polygon points="12,1.5 15,8.5 22.5,9 16.8,14 18.6,21.5 12,17.6 5.4,21.5 7.2,14 1.5,9 9,8.5" {...common} />}
    </svg>
  );
}


function niceKm(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const viewRef = useRef<GameView | null>(null);
  const toastSeen = useRef(new Map<number, number>());
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState<'title' | 'play'>('title');
  const [sel, setSelState] = useState<Sel>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [mode, setModeState] = useState<MapMode>('political');
  const [session, setSession] = useState(0);
  const quality = useMemo(detectQuality, []);

  const g = gameRef.current;
  const v = viewRef.current;

  const setSel = (s: Sel) => {
    setSelState(s);
    if (viewRef.current) viewRef.current.selected = s;
  };

  useEffect(() => {
    const game = new Game();
    game.speed = 0;
    gameRef.current = game;
    const view = new GameView(hostRef.current!, game, quality, {
      onTapStation: (id) => {
        if (id === null) return;
        view.selectedStation = id;
        setPanel({ type: 'station', id });
      },
      onTapRegion: (id) => {
        if (!id) {
          setPanel(null);
          view.selectedStation = null;
          return;
        }
        if (game.cities.some((c) => c.id === id)) setPanel({ type: 'city', id });
      },
      onSelectLine: (s) => {
        view.selected = s;
        setSelState(s);
      },
    });
    viewRef.current = view;
    if (location.search.includes('debug')) (window as unknown as { __gm: unknown }).__gm = { game, view };
    view.focusProvince();
    view.setCamera(-5, -12, view.dist);
    const iv = setInterval(() => setTick((t) => t + 1), 140);
    return () => {
      clearInterval(iv);
      view.dispose();
      viewRef.current = null;
      gameRef.current = null;
    };
  }, [session, quality]);

  useEffect(() => {
    setPhase('title');
    setSelState(null);
    setPanel(null);
  }, [session]);

  if (g && typeof sel === 'number' && !g.lineOf(sel)) setTimeout(() => setSel(null), 0);

  const start = () => {
    if (!g || !v) return;
    g.speed = 1;
    setPhase('play');
    const [x, z] = project(113.2, 23.08);
    const portrait = window.innerHeight > window.innerWidth;
    v.pitch = 0.95;
    v.flyTo(x, z, portrait ? 95 : 70);
  };

  const setMode = (m: MapMode) => {
    setModeState(m);
    v?.setMode(m);
  };

  // ---- 派生数据 ----
  const now = performance.now();
  if (g) {
    for (const t of g.toasts) if (!toastSeen.current.has(t.id)) toastSeen.current.set(t.id, now);
  }
  const toasts = g ? g.toasts.filter((t) => now - (toastSeen.current.get(t.id) ?? now) < 5200).slice(-3) : [];
  const clock = g ? fmtDate(g.day, g.clockHours) : { date: '', time: '' };
  const selLine = g && typeof sel === 'number' ? g.lineOf(sel) : null;
  const scaleKm = v ? niceKm(v.pxWorld * 90) : 1;
  const scalePx = v ? scaleKm / v.pxWorld : 90;
  const lowFps = v && v.fps < 24;

  const stationPanel = g && panel?.type === 'station' ? g.stations[panel.id] : null;
  const cityPanel = g && panel?.type === 'city' ? g.cities.find((c) => c.id === panel.id) : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#070b12] text-slate-100">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="vignette" />

      {/* ============ 顶部 HUD ============ */}
      {g && phase === 'play' && (
        <div className="safe-top pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1.5 px-2">
          <div className="flex items-start justify-between gap-2">
            <div className="gm-panel pointer-events-auto rounded-lg px-2.5 py-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums leading-none text-[#f1dba0]">{clock.time}</span>
                <span className="text-[11px] text-slate-300">{clock.date}</span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[13px]">
                <span className="font-semibold text-amber-300 tabular-nums">¥ {Math.floor(g.money)}</span>
                <span className="text-slate-300">
                  送达 <b className="tabular-nums text-white">{g.delivered}</b>
                </span>
                <span className="text-slate-400">第{g.day + 1}天</span>
              </div>
            </div>
            <div className="pointer-events-auto flex flex-col items-end gap-1.5">
              <div className="gm-panel flex rounded-lg p-1 gap-1">
                {([0, 1, 2, 4] as const).map((s) => (
                  <button key={s} data-on={g.speed === s} className="gm-btn h-8 min-w-9 px-2 text-sm font-semibold" onClick={() => (g.speed = s)}>
                    {s === 0 ? '⏸' : `${s}×`}
                  </button>
                ))}
              </div>
              <div className="gm-panel flex rounded-lg p-1 gap-1">
                {(
                  [
                    ['political', '政区'],
                    ['heat', '客流'],
                    ['terrain', '地形'],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} data-on={mode === m} className="gm-btn h-7 px-2 text-xs font-semibold" onClick={() => setMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {g.event && (
            <div className="slide-up pointer-events-auto mx-auto w-full max-w-md rounded-lg border border-red-400/60 bg-gradient-to-r from-red-900/80 to-red-800/60 px-3 py-1.5 backdrop-blur">
              <div className="flex items-center justify-between text-sm font-bold text-red-100">
                <span>{g.event.kind === 'typhoon' ? '🌀' : g.event.kind === 'rush' ? '🧳' : '🏛️'} {g.event.title}</span>
                <span className="tabular-nums text-xs">{Math.ceil(g.event.left)}s</span>
              </div>
              <div className="text-[11px] text-red-100/85">{g.event.desc}</div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-black/40">
                <div className="h-full bg-red-300" style={{ width: `${(g.event.left / g.event.total) * 100}%` }} />
              </div>
            </div>
          )}

          <div className="mx-auto flex w-full max-w-md flex-col gap-1">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`toast-in rounded-md px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur ${
                  t.kind === 'good' ? 'bg-emerald-900/80 text-emerald-100 border border-emerald-400/40' : t.kind === 'bad' ? 'bg-rose-950/85 text-rose-100 border border-rose-400/40' : 'bg-slate-900/80 text-slate-100 border border-slate-500/40'
                }`}
              >
                {t.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ 右侧工具 ============ */}
      {g && v && phase === 'play' && (
        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
          <div className="pointer-events-auto flex flex-col gap-1.5">
            {[
              ['＋', () => v.zoomBy(0.55)],
              ['－', () => v.zoomBy(1.8)],
              ['🗺', () => v.focusProvince()],
              ['🔬', () => setPanel({ type: 'tech' })],
              ['❔', () => setPanel({ type: 'help' })],
              ['⚙', () => setPanel({ type: 'settings' })],
            ].map(([label, fn], i) => (
              <button key={i} className="gm-btn grid h-10 w-10 place-items-center text-lg" onClick={fn as () => void}>
                {label as string}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ============ 比例尺 ============ */}
      {g && v && phase === 'play' && (
        <div className="pointer-events-none absolute left-2 bottom-[132px] text-[11px] text-slate-200 drop-shadow">
          <div className="flex items-end gap-1">
            <div style={{ width: scalePx }} className="h-2 border-x-2 border-b-2 border-white/90" />
            <span className="font-semibold">{scaleKm >= 1 ? `${scaleKm} km` : `${Math.round(scaleKm * 1000)} m`}</span>
          </div>
          <div className="text-[10px] text-slate-300/80">1:1 真实比例 · 视距 {v.dist >= 10 ? v.dist.toFixed(0) : v.dist.toFixed(2)} km{lowFps ? ' · 帧率偏低，可在⚙降低画质' : ''}</div>
        </div>
      )}

      {/* ============ 底部：线路栏 ============ */}
      {g && phase === 'play' && (
        <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 px-2">
          {/* 面板 */}
          {panel?.type === 'station' && stationPanel && (
            <div className="gm-panel slide-up pointer-events-auto w-full max-w-md rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <ShapeIcon shape={stationPanel.shape} size={26} />
                  <div>
                    <div className="text-base font-bold text-[#f1dba0]">{stationPanel.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {g.cities.find((c) => c.id === stationPanel.cityId)?.short} · {stationPanel.hub ? `立体换乘枢纽（${stationPanel.lineIds.length} 线 ${stationPanel.lineIds.length} 层）` : stationPanel.lineIds.length ? '普通车站' : '未接入线网'} · {stationPanel.lat.toFixed(2)}°N {stationPanel.lon.toFixed(2)}°E
                    </div>
                  </div>
                </div>
                <button className="gm-btn h-7 w-7" onClick={() => { setPanel(null); if (v) v.selectedStation = null; }}>✕</button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {stationPanel.lineIds.map((id) => {
                  const l = g.lineOf(id);
                  return l ? (
                    <span key={id} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-black" style={{ background: l.color }}>
                      {l.name}
                    </span>
                  ) : null;
                })}
                <span className="ml-auto text-[11px] text-slate-300">
                  候车 {stationPanel.waiting.length}/{g.stationCap(stationPanel)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                {SHAPE_LIST.map((sh) => {
                  const n = stationPanel.waiting.filter((p) => p.target === sh).length;
                  return n ? (
                    <span key={sh} className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5">
                      <ShapeIcon shape={sh} size={14} /> ×{n}
                    </span>
                  ) : null;
                })}
                {!stationPanel.waiting.length && <span className="text-slate-400">暂无候车乘客</span>}
              </div>
              <div className="mt-2 flex gap-2">
                <button className="gm-btn h-8 flex-1 text-sm" onClick={() => v?.flyTo(stationPanel.x, stationPanel.z, 1.4)}>聚焦</button>
                <button className="gm-btn h-8 flex-1 text-sm" onClick={() => { if (v) { v.pitch = 0.5; v.flyTo(stationPanel.x, stationPanel.z, 0.28); } }}>
                  近景·看站台
                </button>
              </div>
            </div>
          )}

          {panel?.type === 'city' && cityPanel && (
            <div className="gm-panel slide-up pointer-events-auto w-full max-w-md rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-bold text-[#f1dba0] tracking-widest">{cityPanel.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {cityPanel.unlocked ? '已开通地铁规划' : '尚未开通 · 迷雾中的地区'} · 站点 {g.stations.filter((s) => s.cityId === cityPanel.id && s.revealed).length}/{cityPanel.stationIds.length} · 累计送达 {cityPanel.delivered}
                  </div>
                </div>
                <button className="gm-btn h-7 w-7" onClick={() => setPanel(null)}>✕</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-300">
                {cityPanel.stationIds.map((id) => (
                  <span key={id} className={`rounded px-1.5 py-0.5 ${g.stations[id].revealed ? 'bg-white/15' : 'bg-white/5 text-slate-500'}`}>
                    {g.stations[id].revealed ? g.stations[id].name : '？？？'}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className="gm-btn h-8 flex-1 text-sm"
                  onClick={() => {
                    const s0 = g.stations[cityPanel.stationIds[0]];
                    v?.flyTo(s0.x, s0.z, 22);
                  }}
                >
                  飞往
                </button>
                {!cityPanel.unlocked && (
                  <button className="gm-btn h-8 flex-[2] text-sm font-bold" data-on={g.money >= cityPanel.cost} onClick={() => g.unlockCity(cityPanel.id)}>
                    批准规划 ¥{cityPanel.cost}
                  </button>
                )}
              </div>
            </div>
          )}

          {panel?.type === 'tech' && (
            <div className="gm-panel slide-up pointer-events-auto max-h-[60vh] w-full max-w-md overflow-y-auto rounded-xl p-3 no-scrollbar">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-base font-bold text-[#f1dba0]">🔬 交通科技</div>
                <button className="gm-btn h-7 w-7" onClick={() => setPanel(null)}>✕</button>
              </div>
              <div className="flex flex-col gap-2">
                {TECHS.map((t) => {
                  const lv = g.techs[t.key];
                  const maxed = lv >= t.max;
                  const cost = t.cost(lv);
                  return (
                    <div key={t.key} className="flex items-center gap-2 rounded-lg bg-white/5 p-2">
                      <div className="flex-1">
                        <div className="text-sm font-semibold">
                          {t.name} <span className="text-xs text-amber-300">Lv.{lv}/{t.max}</span>
                        </div>
                        <div className="text-[11px] text-slate-400">{t.desc}</div>
                      </div>
                      <button className="gm-btn h-8 min-w-20 px-2 text-sm font-bold" disabled={maxed} data-on={!maxed && g.money >= cost} onClick={() => g.buyTech(t.key)}>
                        {maxed ? '已满级' : `¥${cost}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {panel?.type === 'settings' && (
            <div className="gm-panel slide-up pointer-events-auto w-full max-w-md rounded-xl p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-base font-bold text-[#f1dba0]">⚙ 画质 · 渲染</div>
                <button className="gm-btn h-7 w-7" onClick={() => setPanel(null)}>✕</button>
              </div>
              <div className="flex gap-2">
                {(
                  [
                    ['low', '流畅'],
                    ['mid', '均衡'],
                    ['high', '光追模拟'],
                  ] as [Quality, string][]
                ).map(([q, label]) => (
                  <button
                    key={q}
                    data-on={quality === q}
                    className="gm-btn h-9 flex-1 text-sm font-semibold"
                    onClick={() => {
                      localStorage.setItem('gd-metro-quality', q);
                      location.reload();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                光追模拟：PBR 材质 + 天空 IBL 环境反射 + 实时软阴影 + GTAO 屏幕空间环境光遮蔽 + HDR 泛光 + ACES 电影色调映射。移动端建议“均衡”。切换画质会重新载入。
              </p>
              <button className="gm-btn mt-2 h-8 w-full text-sm" onClick={() => setSession((s) => s + 1)}>
                重新开局
              </button>
            </div>
          )}

          {panel?.type === 'help' && (
            <div className="gm-panel slide-up pointer-events-auto max-h-[60vh] w-full max-w-md overflow-y-auto rounded-xl p-3 text-[13px] leading-relaxed no-scrollbar">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-base font-bold text-[#f1dba0]">玩法说明</div>
                <button className="gm-btn h-7 w-7" onClick={() => setPanel(null)}>✕</button>
              </div>
              <HelpText />
            </div>
          )}

          {/* 选中线路面板 */}
          {selLine && (
            <div className="gm-panel slide-up pointer-events-auto w-full max-w-md rounded-xl px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-white" style={{ background: selLine.color }} />
                <span className="font-bold">{selLine.name}</span>
                <span className="text-[11px] text-slate-400">
                  {selLine.stations.length} 站{selLine.loop ? ' · 环线' : ''} · {selLine.path.length.toFixed(0)} km · 载客 {g.linePassengers(selLine)}
                </span>
                <button className="gm-btn ml-auto h-7 w-7 text-xs" onClick={() => setSel(null)}>✕</button>
              </div>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                <button className="gm-btn h-9 text-xs font-semibold" onClick={() => g.addTrain(selLine.id)}>＋列车<br />¥{g.trainCost()}</button>
                <button className="gm-btn h-9 text-xs font-semibold" onClick={() => g.addCar(selLine.id)}>＋车厢<br />¥{g.carCost()}</button>
                <button
                  className="gm-btn h-9 text-xs font-semibold"
                  onClick={() => {
                    const t = g.trains.find((x) => x.line === selLine.id);
                    if (t && v) {
                      v.pitch = 0.42;
                      v.follow = t.id;
                    }
                  }}
                >
                  🎥 跟车
                </button>
                <button className="gm-btn h-9 text-xs font-semibold text-rose-300" onClick={() => g.removeLine(selLine.id)}>拆除<br />+¥{Math.round(selLine.invested * 0.5)}</button>
              </div>
              <div className="mt-1 text-[10.5px] text-slate-400">拖线上 ⊕ 把手到车站＝改道 · 拖端点站＝延伸/成环 · 把中间站拖离＝取消停靠</div>
            </div>
          )}
          {sel === 'new' && (
            <div className="gm-panel slide-up pointer-events-auto w-full max-w-md rounded-xl px-3 py-2 text-sm">
              <span className="text-[#f1dba0] font-semibold">新建线路：</span>从任意车站拖拽到另一车站即可开通
              <button className="gm-btn ml-2 h-6 px-2 text-xs" onClick={() => setSel(null)}>取消</button>
            </div>
          )}

          {/* 线路条 */}
          <div className="gm-panel pointer-events-auto flex w-full max-w-md items-center gap-1.5 overflow-x-auto rounded-xl p-1.5 no-scrollbar">
            {g.lines.slice().sort((a, b) => a.slot - b.slot).map((l) => {
              const load = g.linePassengers(l);
              return (
                <button
                  key={l.id}
                  onClick={() => setSel(sel === l.id ? null : l.id)}
                  className={`relative flex h-11 min-w-[52px] flex-col items-center justify-center rounded-lg border-2 px-2 text-[11px] font-bold ${sel === l.id ? 'border-white' : 'border-transparent'}`}
                  style={{ background: l.color + (sel === l.id ? '' : 'cc'), color: l.color === '#fdd835' ? '#222' : '#fff' }}
                >
                  <span>{l.name}</span>
                  <span className="text-[10px] font-medium opacity-90">{load}人</span>
                </button>
              );
            })}
            {g.freeSlot() >= 0 && (
              <button
                data-on={sel === 'new'}
                className="gm-btn h-11 min-w-[52px] shrink-0 px-2 text-xs font-bold"
                onClick={() => setSel(sel === 'new' ? null : 'new')}
              >
                ＋新线
              </button>
            )}
            <div className="ml-auto shrink-0 pl-1 text-right text-[10px] leading-tight text-slate-400">
              线路 {g.lines.length}/{g.maxLines}
              <br />列车 {g.trains.length}
            </div>
          </div>
        </div>
      )}

      {/* ============ 标题界面 ============ */}
      {phase === 'title' && g && (
        <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-gradient-to-b from-black/55 via-black/35 to-black/70 p-4">
          <div className="gm-panel slide-up w-full max-w-md rounded-2xl p-5 text-center">
            <div className="text-[11px] tracking-[0.4em] text-amber-300/80">GUANGDONG · HONG KONG · MACAO</div>
            <h1 className="mt-1 text-3xl font-black tracking-widest text-[#f1dba0]">迷你地铁</h1>
            <div className="text-sm font-semibold text-slate-200">粤港澳大湾区 · 2026 3D 大战略版</div>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-300">
              以 1:1 真实比例的广东全域地图为舞台：广州·佛山·东莞·深圳·香港·澳门·珠海·惠州·肇庆·清远·汕尾·汕头……共 21 地市 + 港澳。
              拖拽铺设线路，打造立体换乘枢纽，驱动写实列车穿越珠江口。
            </p>
            <ul className="mt-3 space-y-1 text-left text-[12.5px] text-slate-300">
              <li>🚇 从车站拖到另一车站建线；拖端点站延伸，点线选中后拖 ⊕ 改道</li>
              <li>🔁 多线交汇自动升级为立体换乘枢纽（多层站台 / 玻璃中庭 / 扶梯）</li>
              <li>🗺 双指缩放 · 旋转 · 倾斜，从全省俯瞰直达站台近景</li>
              <li>🌊 跨海需盾构隧道，造价更高；台风、春运、广交会随机来袭</li>
            </ul>
            <button className="gm-btn mt-4 h-12 w-full text-lg font-black tracking-widest" data-on="true" onClick={start}>
              开始运营
            </button>
            <div className="mt-2 text-[11px] text-slate-500">当前画质：{quality === 'high' ? '光追模拟（高）' : quality === 'mid' ? '均衡' : '流畅'} · 可在游戏内 ⚙ 调整</div>
          </div>
        </div>
      )}

      {/* ============ 游戏结束 ============ */}
      {g?.over && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 p-4">
          <div className="gm-panel slide-up w-full max-w-sm rounded-2xl p-5 text-center">
            <div className="text-2xl font-black text-rose-300">运营中断</div>
            <div className="mt-1 text-sm text-slate-300">{g.overReason}</div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <Stat label="送达乘客" value={String(g.delivered)} />
              <Stat label="运营天数" value={String(g.day + 1)} />
              <Stat label="开通城市" value={String(g.cities.filter((c) => c.unlocked).length)} />
            </div>
            <button className="gm-btn mt-4 h-11 w-full text-base font-bold" data-on="true" onClick={() => setSession((s) => s + 1)}>
              重新开局
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/10 p-2">
      <div className="text-xl font-bold text-[#f1dba0] tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}

function HelpText() {
  return (
    <div className="space-y-2 text-slate-300">
      <p><b className="text-[#f1dba0]">目标：</b>把不同形状的乘客送到对应形状的车站（★ 为各市主枢纽）。车站候车超过容量并持续 {BAL.overSecs} 秒即运营中断。</p>
      <p><b className="text-[#f1dba0]">建线：</b>点 ＋新线（或未选线路时）从车站拖到另一车站。选中线路后，拖端点站可延伸，拖到另一端点可成环线。</p>
      <p><b className="text-[#f1dba0]">改道：</b>点击线路选中，拖动线上的 ⊕ 把手并落在某车站上，该站会被插入线路；把中间站拖离 60px 以上可取消停靠。</p>
      <p><b className="text-[#f1dba0]">换乘枢纽：</b>两条及以上线路共站即为立体枢纽，各线站台分层、斜向交叉，容量 +4；乘客自动按最短路径换乘。</p>
      <p><b className="text-[#f1dba0]">区域拓展：</b>点击灰色（迷雾）城市，花费资金批准规划，新的站点会逐步出现。</p>
      <p><b className="text-[#f1dba0]">经济：</b>票价 = 基础 + 直线距离；造价按真实公里计，跨海隧道约 4 倍，盾构科技可降价。每周有财政补贴。</p>
      <p><b className="text-[#f1dba0]">视角：</b>单指拖动平移，双指缩放/旋转/上下倾斜，双击快速放大；桌面右键拖动旋转，滚轮缩放。点车站→“近景”可观察站台与列车；线路面板“跟车”可跟随列车。</p>
      <p><b className="text-[#f1dba0]">地图模式：</b>政区（P 社风）/ 客流热力 / 地形。昼夜循环影响灯光与建筑夜景。</p>
    </div>
  );
}
