import { useEffect, useMemo, useRef, useState } from 'react';
import { Game } from './game/engine';
import { GameView, detectQuality } from './game/view';
import { project } from './game/geo';
import { useUI } from './store';
import { RightTools, ScaleBar, TopHud } from './ui/hud';
import { CitiesPanel, CityPanel, HelpPanel, LineBar, LinePanel, SettingsPanel, StationPanel, TechPanel } from './ui/panels';
import { GameOver, TitleScreen } from './ui/screens';

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const viewRef = useRef<GameView | null>(null);
  const toastSeen = useRef(new Map<number, number>());
  const [, setTick] = useState(0);

  const phase = useUI((s) => s.phase);
  const panel = useUI((s) => s.panel);
  const sel = useUI((s) => s.sel);
  const mode = useUI((s) => s.mode);
  const session = useUI((s) => s.session);
  const setPhase = useUI((s) => s.setPhase);
  const setPanel = useUI((s) => s.setPanel);
  const setSel = useUI((s) => s.setSel);
  const setQuality = useUI((s) => s.setQuality);

  const detected = useMemo(detectQuality, []);

  useEffect(() => {
    setQuality(detected);
    const game = new Game();
    game.speed = 0;
    gameRef.current = game;
    const view = new GameView(hostRef.current!, game, detected, {
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
      onSelectLine: (s) => setSel(s),
    });
    viewRef.current = view;
    if (location.search.includes('debug')) (window as unknown as { __gm: unknown }).__gm = { game, view };
    view.focusProvince();
    const iv = setInterval(() => setTick((t) => t + 1), 140);
    return () => {
      clearInterval(iv);
      view.dispose();
      viewRef.current = null;
      gameRef.current = null;
    };
  }, [session, detected, setPanel, setSel, setQuality]);

  useEffect(() => {
    setPhase('title');
    setSel(null);
    setPanel(null);
  }, [session, setPhase, setSel, setPanel]);

  const g = gameRef.current;
  const v = viewRef.current;

  // 画质 / 地图模式 / 选中线路同步到渲染层
  useEffect(() => {
    v?.setMode(mode);
  }, [v, mode]);
  useEffect(() => {
    if (v) v.selected = sel;
  }, [v, sel]);

  const start = () => {
    if (!g || !v) return;
    g.speed = 1;
    setPhase('play');
    const [x, z] = project(113.12, 23.02); // 佛山
    const portrait = window.innerHeight > window.innerWidth;
    v.pitch = 0.95;
    v.flyTo(x, z, portrait ? 72 : 54);
  };

  if (!g || !v) {
    return <div className="relative h-full w-full overflow-hidden bg-[#070b12] text-slate-100"><div ref={hostRef} className="absolute inset-0" /></div>;
  }

  // 可见 toast（5.2 秒淡出）
  const now = performance.now();
  for (const t of g.toasts) if (!toastSeen.current.has(t.id)) toastSeen.current.set(t.id, now);
  const toasts = g.toasts.filter((t) => now - (toastSeen.current.get(t.id) ?? now) < 5200).slice(-3);
  const selLine = typeof sel === 'number' ? g.lineOf(sel) : null;
  const lowFps = v.fps < 24;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#070b12] text-slate-100">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="vignette" />

      {phase === 'play' && <TopHud game={g} mode={mode} toasts={toasts} />}
      {phase === 'play' && <RightTools view={v} />}
      {phase === 'play' && <ScaleBar view={v} lowFps={lowFps} />}

      {phase === 'play' && (
        <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 px-2">
          {panel?.type === 'station' && <StationPanel game={g} view={v} id={panel.id} />}
          {panel?.type === 'city' && <CityPanel game={g} view={v} id={panel.id} />}
          {panel?.type === 'cities' && <CitiesPanel game={g} />}
          {panel?.type === 'tech' && <TechPanel game={g} />}
          {panel?.type === 'settings' && <SettingsPanel game={g} />}
          {panel?.type === 'help' && <HelpPanel />}
          {selLine && <LinePanel game={g} view={v} lineId={selLine.id} />}
          {sel === 'new' && (
            <div className="gm-panel slide-up pointer-events-auto w-full max-w-md rounded-xl px-3 py-2 text-sm">
              <span className="font-semibold text-[#f1dba0]">新建线路：</span>从任意车站拖拽到另一车站即可开通
              <button className="gm-btn ml-2 h-6 px-2 text-xs" onClick={() => setSel(null)}>
                取消
              </button>
            </div>
          )}
          <LineBar game={g} />
        </div>
      )}

      {phase === 'title' && <TitleScreen onStart={start} />}
      {g.over && <GameOver game={g} />}
    </div>
  );
}
