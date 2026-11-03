import { buildWater } from '../src/game/water';
import { PROJECTED_LAKES, REGIONS, BOUNDS } from '../src/game/geo';
import fs from 'node:fs';
const { water, bank } = buildWater(0.7);
const tris = [];
const push = (b, tag) => {
  const p = b.pos, c = b.col, ix = b.idx;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, bb = ix[i + 1] * 3, cc = ix[i + 2] * 3;
    tris.push({ t: tag, p: [p[a], p[a + 1], p[a + 2], p[bb], p[bb + 1], p[bb + 2], p[cc], p[cc + 1], p[cc + 2]], c: [c[a], c[a + 1], c[a + 2]] });
  }
};
push(water, 'w'); push(bank, 'b');
fs.writeFileSync('/tmp/t/water2.json', JSON.stringify({
  tris, bounds: BOUNDS,
  lakes: PROJECTED_LAKES.map((l) => ({ n: l.name, pts: l.pts })),
  regions: REGIONS.map((r) => ({ n: r.name, polys: r.polys })),
}));
console.log('tris', tris.length);
