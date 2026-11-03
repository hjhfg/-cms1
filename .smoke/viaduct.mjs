import { buildPath, VIADUCT_H } from '../src/game/path';
import { buildWallGeometry } from '../src/game/ribbon';
import { buildWater } from '../src/game/water';

const path = buildPath({
  pts: [[0, 0], [30, 5], [60, 40], [95, 44]],
  elev: [VIADUCT_H, VIADUCT_H, VIADUCT_H, VIADUCT_H],
  lanes: [0, 0, 0],
  loop: false,
  arch: [{ h: 0, t0: 0, t1: 0 }, { h: 0.028, t0: 0.3, t1: 0.7 }, { h: 0, t0: 0, t1: 0 }],
});
console.log('path n', path.n, 'len', path.length.toFixed(2), 'minY', Math.min(...path.py).toFixed(4), 'maxY', Math.max(...path.py).toFixed(4));

for (const side of [1, -1]) {
  const g = buildWallGeometry(path.px, path.py, path.pz, path.cum, 0.0046, side, -0.0019, 0, 0.24, 1);
  const pos = g.getAttribute('position').array;
  let bad = 0;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) bad++;
  console.log('wall side', side, 'verts', pos.length / 3, 'NaN', bad, 'tris', g.index.count / 3);
}

// 桥墩数量估算
const span = Math.max(0.09, path.length / 420);
let acc = 0, piers = 0;
for (let i = 0; i < path.n; i++) {
  if (i > 0) acc += path.cum[i] - path.cum[i - 1];
  if (acc >= span) { acc = 0; if (path.py[i] < VIADUCT_H + 0.0035) piers++; }
}
console.log('span km', span.toFixed(3), 'piers', piers);

const t0 = Date.now();
const w = buildWater(0.7);
console.log('buildWater ms', Date.now() - t0, 'water tris', w.water.idx.length / 3, 'bank tris', w.bank.idx.length / 3);
