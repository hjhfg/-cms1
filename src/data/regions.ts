export type Shape = 'circle' | 'triangle' | 'square' | 'diamond' | 'pentagon' | 'star' | 'cross';

export interface StationDef {
  name: string;
  lon: number;
  lat: number;
  tier: 1 | 2 | 3;
  shape?: Shape;
}

export const BASE_SHAPES: Shape[] = ['circle', 'triangle', 'square', 'diamond', 'pentagon', 'cross'];

export const LINE_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#ec407a'];
export const LINE_NAMES = ['1号线', '2号线', '3号线', '4号线', '5号线', '6号线', '7号线', '8号线'];
