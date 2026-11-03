import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Shape } from '../data/regions';
import { cn } from '../utils/cn';

export const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function fmtDate(day: number, hours: number) {
  const d = new Date(2026, 0, 5 + day);
  const hh = Math.floor(hours);
  const mm = Math.floor((hours - hh) * 60);
  return {
    date: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`,
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
  };
}

export function niceKm(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

export function ShapeIcon({ shape, size = 18, color = '#fff' }: { shape: Shape; size?: number; color?: string }) {
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

export function Panel({
  title,
  icon,
  onClose,
  children,
  className,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('gm-panel slide-up pointer-events-auto w-full max-w-md rounded-xl p-3', className)}>
      <div className="mb-1.5 flex items-center gap-2">
        {icon}
        <div className="text-base font-bold text-[#f1dba0]">{title}</div>
        <button className="gm-btn ml-auto grid h-7 w-7 place-items-center" onClick={onClose} aria-label="关闭">
          <X size={14} />
        </button>
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/10 p-2">
      <div className="text-xl font-bold text-[#f1dba0] tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}

export function Chip({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[11px]', dim ? 'bg-white/5 text-slate-500' : 'bg-white/15 text-slate-200')}>
      {children}
    </span>
  );
}
