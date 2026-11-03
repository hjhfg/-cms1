import { Waves } from 'lucide-react';
import type { Game } from '../game/engine';
import { CITY_META } from '../data/cities';
import { useUI } from '../store';
import { Stat } from './primitives';

export function TitleScreen({ onStart }: { onStart: () => void }) {
  const quality = useUI((s) => s.quality);
  const cities = CITY_META.length;
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-gradient-to-b from-black/55 via-black/35 to-black/70 p-4">
      <div className="gm-panel slide-up w-full max-w-md rounded-2xl p-5 text-center">
        <div className="text-[11px] tracking-[0.32em] text-amber-300/80">GUANGDONG · GUANGXI · HAINAN · YUNNAN</div>
        <h1 className="mt-1 text-3xl font-black tracking-widest text-[#f1dba0]">迷你地铁</h1>
        <div className="text-sm font-semibold text-slate-200">粤桂琼滇 · 2026 3D 大战略版</div>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-300">
          1:1 真实经纬度的南方地图：广东（含港澳）23 · 广西 14 · 海南 18 · 云南 16，共 {cities} 个地级行政区、408 个区县、4000+ 个镇街。
          本局从<strong className="text-[#f1dba0]">佛山</strong>起步，广州要花钱解锁。
        </p>
        <ul className="mt-3 space-y-1 text-left text-[12.5px] text-slate-300">
          <li>🚇 车站每局按真实区县/镇街程序化布点，形状随机，不再固定四站</li>
          <li>🌉 跨河 / 跨江 / 跨海自动架桥：桥墩、箱梁、斜拉塔与拉索，列车走拱形桥面</li>
          <li>🌊 西江、北江、东江、郁江、金沙江、澜沧江…… 26 条干流为独立 3D 水面</li>
          <li>🗺 广东 / 广西 / 海南 / 云南全域俯瞰，可下潜到站台近景</li>
        </ul>
        <button className="gm-btn mt-4 h-12 w-full text-lg font-black tracking-widest" data-on="true" onClick={onStart}>
          开始运营
        </button>
        <div className="mt-2 flex items-center justify-center gap-1 text-[11px] text-slate-500">
          <Waves size={11} />
          当前画质：{quality === 'high' ? '光追模拟（高）' : quality === 'mid' ? '均衡' : '流畅'} · 可在游戏内设置调整
        </div>
      </div>
    </div>
  );
}

export function GameOver({ game }: { game: Game }) {
  const restart = useUI((s) => s.restart);
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 p-4">
      <div className="gm-panel slide-up w-full max-w-sm rounded-2xl p-5 text-center">
        <div className="text-2xl font-black text-rose-300">运营中断</div>
        <div className="mt-1 text-sm text-slate-300">{game.overReason}</div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <Stat label="送达乘客" value={String(game.delivered)} />
          <Stat label="运营天数" value={String(game.day + 1)} />
          <Stat label="开通城市" value={String(game.cities.filter((c) => c.unlocked).length)} />
        </div>
        <button className="gm-btn mt-4 h-11 w-full text-base font-bold" data-on="true" onClick={restart}>
          重新开局
        </button>
      </div>
    </div>
  );
}
