import { CircleHelp, FlaskConical, Layers, Maximize2, Minus, Pause, Play, Plus, Settings, TrainFront } from 'lucide-react';
import type { Game, Toast } from '../game/engine';
import type { GameView } from '../game/view';
import type { MapMode } from '../game/world';
import { useUI } from '../store';
import { cn } from '../utils/cn';
import { fmtDate, niceKm } from './primitives';

const SPEEDS = [0, 1, 2, 4] as const;

export function TopHud({ game, mode, toasts }: { game: Game; mode: MapMode; toasts: Toast[] }) {
  const setMode = useUI((s) => s.setMode);
  const setPanel = useUI((s) => s.setPanel);
  const clock = fmtDate(game.day, game.clockHours);
  return (
    <div className="safe-top pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1.5 px-2">
      <div className="flex items-start justify-between gap-2">
        <div className="gm-panel pointer-events-auto rounded-lg px-2.5 py-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold tabular-nums leading-none text-[#f1dba0]">{clock.time}</span>
            <span className="text-[11px] text-slate-300">{clock.date}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[13px]">
            <span className="font-semibold text-amber-300 tabular-nums">¥ {Math.floor(game.money)}</span>
            <span className="text-slate-300">
              送达 <b className="tabular-nums text-white">{game.delivered}</b>
            </span>
            <span className="text-slate-400">第{game.day + 1}天</span>
          </div>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="gm-panel flex gap-1 rounded-lg p-1">
            {SPEEDS.map((s) => (
              <button key={s} data-on={game.speed === s} className="gm-btn grid h-8 min-w-9 place-items-center px-2" onClick={() => (game.speed = s)}>
                {s === 0 ? <Pause size={14} /> : s === 1 ? <Play size={14} /> : <span className="text-sm font-semibold">{s}×</span>}
              </button>
            ))}
          </div>
          <div className="gm-panel flex gap-1 rounded-lg p-1">
            {(
              [
                ['political', '政区', Layers],
                ['heat', '客流', TrainFront],
                ['terrain', '地形', Maximize2],
              ] as const
            ).map(([m, label, Icon]) => (
              <button key={m} data-on={mode === m} className="gm-btn flex h-7 items-center gap-1 px-2 text-xs font-semibold" onClick={() => setMode(m)}>
                <Icon size={12} />
                {label}
              </button>
            ))}
            <button className="gm-btn flex h-7 items-center gap-1 px-2 text-xs font-semibold" onClick={() => setPanel({ type: 'cities' })}>
              城市
            </button>
          </div>
        </div>
      </div>

      {game.event && (
        <div className="slide-up pointer-events-auto mx-auto w-full max-w-md rounded-lg border border-red-400/60 bg-gradient-to-r from-red-900/80 to-red-800/60 px-3 py-1.5 backdrop-blur">
          <div className="flex items-center justify-between text-sm font-bold text-red-100">
            <span>
              {game.event.kind === 'typhoon' ? '🌀' : game.event.kind === 'rush' ? '🧳' : '🏛️'} {game.event.title}
            </span>
            <span className="text-xs tabular-nums">{Math.ceil(game.event.left)}s</span>
          </div>
          <div className="text-[11px] text-red-100/85">{game.event.desc}</div>
          <div className="mt-1 h-1 overflow-hidden rounded bg-black/40">
            <div className="h-full bg-red-300" style={{ width: `${(game.event.left / game.event.total) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-md flex-col gap-1">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'toast-in rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur',
              t.kind === 'good'
                ? 'border-emerald-400/40 bg-emerald-900/80 text-emerald-100'
                : t.kind === 'bad'
                  ? 'border-rose-400/40 bg-rose-950/85 text-rose-100'
                  : 'border-slate-500/40 bg-slate-900/80 text-slate-100',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RightTools({ view }: { view: GameView }) {
  const setPanel = useUI((s) => s.setPanel);
  const tools = [
    { icon: Plus, onClick: () => view.zoomBy(0.55), label: '放大' },
    { icon: Minus, onClick: () => view.zoomBy(1.8), label: '缩小' },
    { icon: Maximize2, onClick: () => view.focusProvince(), label: '全域' },
    { icon: FlaskConical, onClick: () => setPanel({ type: 'tech' }), label: '科技' },
    { icon: CircleHelp, onClick: () => setPanel({ type: 'help' }), label: '帮助' },
    { icon: Settings, onClick: () => setPanel({ type: 'settings' }), label: '设置' },
  ];
  return (
    <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
      <div className="pointer-events-auto flex flex-col gap-1.5">
        {tools.map(({ icon: Icon, onClick, label }) => (
          <button key={label} className="gm-btn grid h-10 w-10 place-items-center" onClick={onClick} aria-label={label} title={label}>
            <Icon size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScaleBar({ view, lowFps }: { view: GameView; lowFps: boolean }) {
  const scaleKm = niceKm(view.pxWorld * 90);
  const scalePx = scaleKm / view.pxWorld;
  return (
    <div className="pointer-events-none absolute bottom-[132px] left-2 text-[11px] text-slate-200 drop-shadow">
      <div className="flex items-end gap-1">
        <div style={{ width: scalePx }} className="h-2 border-x-2 border-b-2 border-white/90" />
        <span className="font-semibold">{scaleKm >= 1 ? `${scaleKm} km` : `${Math.round(scaleKm * 1000)} m`}</span>
      </div>
      <div className="text-[10px] text-slate-300/80">
        1:1 真实比例 · 视距 {view.dist >= 10 ? view.dist.toFixed(0) : view.dist.toFixed(2)} km
        {lowFps ? ' · 帧率偏低，可在设置里降低画质' : ''}
      </div>
    </div>
  );
}
