import { create } from 'zustand';
import type { Sel } from './game/view';
import type { MapMode, Quality } from './game/world';

export type Panel =
  | null
  | { type: 'station'; id: number }
  | { type: 'city'; id: string }
  | { type: 'tech' }
  | { type: 'help' }
  | { type: 'settings' }
  | { type: 'cities' };

interface UIState {
  phase: 'title' | 'play';
  panel: Panel;
  sel: Sel;
  mode: MapMode;
  quality: Quality;
  session: number;
  setPhase: (p: 'title' | 'play') => void;
  setPanel: (p: Panel) => void;
  setSel: (s: Sel) => void;
  setMode: (m: MapMode) => void;
  setQuality: (q: Quality) => void;
  restart: () => void;
}

export const useUI = create<UIState>((set) => ({
  phase: 'title',
  panel: null,
  sel: null,
  mode: 'political',
  quality: 'high',
  session: 0,
  setPhase: (phase) => set({ phase }),
  setPanel: (panel) => set({ panel }),
  setSel: (sel) => set({ sel }),
  setMode: (mode) => set({ mode }),
  setQuality: (quality) => set({ quality }),
  restart: () => set((s) => ({ session: s.session + 1, phase: 'title', panel: null, sel: null })),
}));
