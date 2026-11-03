import { useMemo, useState } from 'react';
import { Building2, Camera, ChevronRight, Coins, Landmark, MapPin, Plus, Route, Search, TrainFront, Trash2, Waves } from 'lucide-react';
import { BAL, SHAPE_LIST, TECHS, type Game } from '../game/engine';
import { PROJECTED_RIVERS } from '../game/geo';
import { cityDivisions } from '../game/stationGen';
import { CITY_META, PROVINCE_NAME, type CityMeta } from '../data/cities';
import type { GameView } from '../game/view';
import { useUI } from '../store';
import { cn } from '../utils/cn';
import { Chip, Panel, ShapeIcon } from './primitives';

const META_BY_ID = new Map(CITY_META.map((c) => [c.id, c]));

export function StationPanel({ game, view, id }: { game: Game; view: GameView; id: number }) {
  const setPanel = useUI((s) => s.setPanel);
  const st = game.stations[id];
  if (!st) return null;
  const city = game.cities.find((c) => c.id === st.cityId);
  return (
    <Panel
      icon={<ShapeIcon shape={st.shape} size={24} />}
      title={st.name}
      onClose={() => {
        setPanel(null);
        view.selectedStation = null;
      }}
    >
      <div className="text-[11px] text-slate-400">
        {city?.short} · {st.hub ? `立体换乘枢纽（${st.lineIds.length} 线 ${st.lineIds.length} 层）` : st.lineIds.length ? '普通车站' : '未接入线网'} ·{' '}
        {st.lat.toFixed(2)}°N {st.lon.toFixed(2)}°E
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {st.lineIds.map((lid) => {
          const l = game.lineOf(lid);
          return l ? (
            <span key={lid} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-black" style={{ background: l.color }}>
              {l.name}
            </span>
          ) : null;
        })}
        <span className="ml-auto text-[11px] text-slate-300">
          候车 {st.waiting.length}/{game.stationCap(st)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
        {SHAPE_LIST.map((sh) => {
          const n = st.waiting.filter((p) => p.target === sh).length;
          return n ? (
            <span key={sh} className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5">
              <ShapeIcon shape={sh} size={14} /> ×{n}
            </span>
          ) : null;
        })}
        {!st.waiting.length && <span className="text-slate-400">暂无候车乘客</span>}
      </div>
      <div className="mt-2 flex gap-2">
        <button className="gm-btn flex h-8 flex-1 items-center justify-center gap-1 text-sm" onClick={() => view.flyTo(st.x, st.z, 1.4)}>
          <MapPin size={13} /> 聚焦
        </button>
        <button
          className="gm-btn flex h-8 flex-1 items-center justify-center gap-1 text-sm"
          onClick={() => {
            view.pitch = 0.5;
            view.flyTo(st.x, st.z, 0.28);
          }}
        >
          <Building2 size={13} /> 近景·看站台
        </button>
      </div>
    </Panel>
  );
}

function DivisionList({ cityId, locked }: { cityId: string; locked: boolean }) {
  const divs = cityDivisions(cityId);
  if (!divs.length) return null;
  return (
    <div className="no-scrollbar mt-2 max-h-44 overflow-y-auto rounded-lg bg-black/25 p-1.5">
      {divs.map((d) => (
        <div key={d.n} className="flex items-start gap-1.5 border-b border-white/5 py-1 last:border-0">
          <span className={cn('min-w-16 shrink-0 text-[12px] font-semibold', locked ? 'text-slate-400' : 'text-slate-200')}>{d.n}</span>
          <div className="flex flex-wrap gap-1">
            {d.t.slice(0, 10).map((t) => (
              <Chip key={t} dim={locked}>
                {t}
              </Chip>
            ))}
            {!d.t.length && <span className="text-[11px] text-slate-500">（暂无乡镇数据）</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CityPanel({ game, view, id }: { game: Game; view: GameView; id: string }) {
  const setPanel = useUI((s) => s.setPanel);
  const city = game.cities.find((c) => c.id === id);
  const meta = META_BY_ID.get(id) as CityMeta | undefined;
  if (!city || !meta) return null;
  const divs = cityDivisions(id);
  const towns = divs.reduce((n, d) => n + d.t.length, 0);
  const revealed = city.stationIds.filter((sid) => game.stations[sid].revealed).length;
  const first = city.stationIds.length ? game.stations[city.stationIds[0]] : null;
  return (
    <Panel
      icon={<Landmark size={18} className="text-[#f1dba0]" />}
      title={city.name}
      onClose={() => setPanel(null)}
    >
      <div className="text-[11px] text-slate-400">
        {PROVINCE_NAME[meta.province]} · {meta.lon.toFixed(2)}°E {meta.lat.toFixed(2)}°N · {Math.round(meta.area).toLocaleString()} km²
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1 text-center">
        {[
          ['区县', String(divs.length)],
          ['乡镇', String(towns)],
          ['站点', city.stationIds.length ? `${revealed}/${city.stationIds.length}` : '待解锁'],
          ['送达', String(city.delivered)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/10 py-1">
            <div className="text-[13px] font-bold tabular-nums text-[#f1dba0]">{v}</div>
            <div className="text-[10px] text-slate-400">{k}</div>
          </div>
        ))}
      </div>
      {city.unlocked ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {city.stationIds.map((sid) => (
            <Chip key={sid} dim={!game.stations[sid].revealed}>
              {game.stations[sid].revealed ? game.stations[sid].name : '？？？'}
            </Chip>
          ))}
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-300/5 px-2 py-1.5 text-[11.5px] text-amber-100/90">
          迷雾中的城市：区县与乡镇已上图，批准规划后才会生成车站与客流。
        </div>
      )}
      <div className="mt-1 text-[10.5px] font-semibold text-slate-400">区县 · 乡镇</div>
      <DivisionList cityId={id} locked={!city.unlocked} />
      <div className="mt-2 flex gap-2">
        <button
          className="gm-btn flex h-9 flex-1 items-center justify-center gap-1 text-sm"
          onClick={() => first && view.flyTo(first.x, first.z, 26)}
        >
          <MapPin size={13} /> 飞往
        </button>
        {!city.unlocked && (
          <button
            className="gm-btn flex h-9 flex-[2] items-center justify-center gap-1 text-sm font-bold"
            data-on={game.money >= city.cost}
            onClick={() => game.unlockCity(city.id)}
          >
            <Coins size={13} /> 批准规划 ¥{city.cost}
          </button>
        )}
      </div>
    </Panel>
  );
}

export function CitiesPanel({ game }: { game: Game }) {
  const setPanel = useUI((s) => s.setPanel);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const rows = game.cities
      .map((c) => ({ c, m: META_BY_ID.get(c.id)! }))
      .filter(({ c, m }) => m && (c.name.includes(q) || c.short.includes(q) || m.province.includes(q.toUpperCase() as never)));
    return rows.sort((a, b) => Number(b.c.unlocked) - Number(a.c.unlocked) || a.c.cost - b.c.cost);
  }, [game, q]);
  const unlocked = game.cities.filter((c) => c.unlocked).length;
  return (
    <Panel icon={<Route size={18} className="text-[#f1dba0]" />} title={`城市 · ${unlocked}/${game.cities.length}`} onClose={() => setPanel(null)}>
      <div className="flex items-center gap-1.5 rounded-lg bg-black/30 px-2">
        <Search size={13} className="text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索城市 / 简称"
          className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-500"
        />
      </div>
      <div className="no-scrollbar mt-1.5 max-h-[46vh] overflow-y-auto">
        {list.map(({ c, m }) => (
          <button
            key={c.id}
            onClick={() => setPanel({ type: 'city', id: c.id })}
            className="flex w-full items-center gap-2 border-b border-white/5 px-1 py-1.5 text-left hover:bg-white/5"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="text-[12.5px] font-semibold text-slate-100">{c.short}</span>
            <span className="truncate text-[10.5px] text-slate-500">{PROVINCE_NAME[m.province]}</span>
            <span className="ml-auto shrink-0 text-[11px] tabular-nums">
              {c.unlocked ? <span className="text-emerald-300">已开通</span> : <span className={game.money >= c.cost ? 'text-amber-300' : 'text-slate-500'}>¥{c.cost}</span>}
            </span>
            <ChevronRight size={13} className="shrink-0 text-slate-500" />
          </button>
        ))}
      </div>
    </Panel>
  );
}

export function LinePanel({ game, view, lineId }: { game: Game; view: GameView; lineId: number }) {
  const setSel = useUI((s) => s.setSel);
  const line = game.lineOf(lineId);
  const setPanel = useUI((s) => s.setPanel);
  if (!line) return null;
  const bridgeKm = line.bridges.reduce((n, b) => n + b.km, 0);
  return (
    <div className="gm-panel slide-up pointer-events-auto w-full max-w-md rounded-xl px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="h-4 w-4 rounded-full border-2 border-white" style={{ background: line.color }} />
        <span className="font-bold">{line.name}</span>
        <span className="text-[11px] text-slate-400">
          {line.stations.length} 站{line.loop ? ' · 环线' : ''} · {line.path.length.toFixed(0)} km · 载客 {game.linePassengers(line)}
        </span>
        <button
          className="gm-btn ml-auto grid h-7 w-7 place-items-center text-xs"
          onClick={() => {
            setSel(null);
            setPanel(null);
          }}
        >
          ✕
        </button>
      </div>
      {!!line.bridges.length && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Waves size={12} className="text-cyan-300" />
          {line.bridges.map((b, i) => (
            <span key={i} className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-[10.5px] text-cyan-100">
              {b.name} {b.km.toFixed(1)}km · {game.stations[b.a].name}–{game.stations[b.b].name}
            </span>
          ))}
          <span className="text-[10px] text-slate-500">水上 {bridgeKm.toFixed(0)}km</span>
        </div>
      )}
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        <button className="gm-btn flex h-9 flex-col items-center justify-center text-[11px] font-semibold leading-tight" onClick={() => game.addTrain(line.id)}>
          <Plus size={12} />
          列车 ¥{game.trainCost()}
        </button>
        <button className="gm-btn flex h-9 flex-col items-center justify-center text-[11px] font-semibold leading-tight" onClick={() => game.addCar(line.id)}>
          <TrainFront size={12} />
          车厢 ¥{game.carCost()}
        </button>
        <button
          className="gm-btn flex h-9 flex-col items-center justify-center text-[11px] font-semibold leading-tight"
          onClick={() => {
            const t = game.trains.find((x) => x.line === line.id);
            if (t) {
              view.pitch = 0.42;
              view.follow = t.id;
            }
          }}
        >
          <Camera size={12} />
          跟车
        </button>
        <button
          className="gm-btn flex h-9 flex-col items-center justify-center text-[11px] font-semibold leading-tight text-rose-300"
          onClick={() => game.removeLine(line.id)}
        >
          <Trash2 size={12} />
          拆除 +¥{Math.round(line.invested * 0.5)}
        </button>
      </div>
      <div className="mt-1 text-[10.5px] text-slate-400">跨河 / 跨江 / 跨海段会自动架桥（斜拉桥塔与桥墩）。拖线上 ⊕ 把手改道，拖端点站延伸或成环。</div>
    </div>
  );
}

export function TechPanel({ game }: { game: Game }) {
  const setPanel = useUI((s) => s.setPanel);
  return (
    <Panel title="交通科技" icon={<Coins size={18} className="text-[#f1dba0]" />} onClose={() => setPanel(null)} className="max-h-[60vh] overflow-y-auto no-scrollbar">
      <div className="flex flex-col gap-2">
        {TECHS.map((t) => {
          const lv = game.techs[t.key];
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
              <button
                className="gm-btn h-8 min-w-20 px-2 text-sm font-bold"
                disabled={maxed}
                data-on={!maxed && game.money >= cost}
                onClick={() => game.buyTech(t.key)}
              >
                {maxed ? '已满级' : `¥${cost}`}
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function SettingsPanel({ game }: { game: Game }) {
  const { setPanel, quality, restart } = useUI();
  return (
    <Panel title="画质 · 渲染" icon={<Waves size={18} className="text-[#f1dba0]" />} onClose={() => setPanel(null)}>
      <div className="flex gap-2">
        {(
          [
            ['low', '流畅'],
            ['mid', '均衡'],
            ['high', '光追模拟'],
          ] as const
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
        PBR 材质 + 天空 IBL 反射 + 实时软阴影 + GTAO + DPR 泛光 + ACES 色调映射。河流为独立水面（法线流动 + 清漆反射），跨水段自动生成桥墩与斜拉桥塔。移动端建议“均衡”。
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div className="rounded-lg bg-white/5 p-2">
          水系：{PROJECTED_RIVERS.length} 条干流 · 西江 / 北江 / 东江 / 郁江 / 金沙江 / 澜沧江
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          城市：{game.cities.length} 个地级行政区（广东 23 · 广西 14 · 海南 18 · 云南 16）
        </div>
      </div>
      <button className="gm-btn mt-2 h-8 w-full text-sm" onClick={restart}>
        重新开局
      </button>
    </Panel>
  );
}

export function HelpPanel() {
  const setPanel = useUI((s) => s.setPanel);
  return (
    <Panel title="玩法说明" onClose={() => setPanel(null)} className="max-h-[60vh] overflow-y-auto no-scrollbar text-[13px] leading-relaxed">
      <div className="space-y-2 text-slate-300">
        <p>
          <b className="text-[#f1dba0]">目标：</b>把不同形状的乘客送到对应形状的车站（★ 为各市主枢纽）。车站候车超过容量并持续 {BAL.overSecs} 秒即运营中断。
        </p>
        <p>
          <b className="text-[#f1dba0]">开局：</b>本局从<strong>佛山</strong>起步，只有佛山的少量站点已开放。广州、深圳、南宁、昆明等城市要花资金批准规划（城市面板可查价与区县乡镇）。
        </p>
        <p>
          <b className="text-[#f1dba0]">站点是生成的：</b>每局按真实区县与镇街随机布点、随机形状，所以同一个城市每局都不一样，没有“固定四站”。
        </p>
        <p>
          <b className="text-[#f1dba0]">建线：</b>点＋新线，从车站拖到另一车站。选中线路后拖端点站延伸，拖到另一端点成环线；拖线上 ⊕ 把手落到车站＝改道。
        </p>
        <p>
          <b className="text-[#f1dba0]">桥梁：</b>线路跨水会自动成桥——跨河大桥（河）、跨江大桥（江）、跨海大桥（海，斜拉桥塔）。湖面越宽造价越高，盾构科技只折跨海；列车沿拱形桥面过江。
        </p>
        <p>
          <b className="text-[#f1dba0]">换乘枢纽：</b>两线及以上共站自动升级为立体枢纽，容量更大；乘客按最短路自动换乘。
        </p>
        <p>
          <b className="text-[#f1dba0]">经济：</b>票价＝基础＋直线距离；每周财政补贴；台风、春运、广交会随机来袭。
        </p>
        <p>
          <b className="text-[#f1dba0]">视角：</b>单指拖动平移，双指缩放/旋转/倾斜；桌面右键旋转、滚轮缩放。车站面板“近景·看站台”可下到站台高度看列车与桥梁。
        </p>
      </div>
    </Panel>
  );
}

export function LineBar({ game }: { game: Game }) {
  const { sel, setSel, setPanel } = useUI();
  return (
    <div className="gm-panel pointer-events-auto flex w-full max-w-md items-center gap-1.5 overflow-x-auto rounded-xl p-1.5 no-scrollbar">
      {game.lines
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map((l) => {
          const load = game.linePassengers(l);
          return (
            <button
              key={l.id}
              onClick={() => {
                setSel(sel === l.id ? null : l.id);
                setPanel(null);
              }}
              className={cn(
                'relative flex h-11 min-w-[52px] flex-col items-center justify-center rounded-lg border-2 px-2 text-[11px] font-bold',
                sel === l.id ? 'border-white' : 'border-transparent',
              )}
              style={{ background: l.color + (sel === l.id ? '' : 'cc'), color: l.color === '#fdd835' ? '#222' : '#fff' }}
            >
              <span>{l.name}</span>
              <span className="text-[10px] font-medium opacity-90">{load}人</span>
            </button>
          );
        })}
      {game.freeSlot() >= 0 && (
        <button
          data-on={sel === 'new'}
          className="gm-btn h-11 min-w-[52px] shrink-0 px-2 text-xs font-bold"
          onClick={() => setSel(sel === 'new' ? null : 'new')}
        >
          ＋新线
        </button>
      )}
      <div className="ml-auto shrink-0 pl-1 text-right text-[10px] leading-tight text-slate-400">
        线路 {game.lines.length}/{game.maxLines}
        <br />列车 {game.trains.length}
      </div>
    </div>
  );
}
