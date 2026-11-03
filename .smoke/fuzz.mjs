import { Game } from '../src/game/engine';
import { isWater } from '../src/game/geo';
let bad = 0;
const kinds = { river: 0, jiang: 0, sea: 0, lake: 0 };
let waterStations = 0, total = 0;
for (let round = 0; round < 2; round++) {
  const g = new Game(1234 + round * 77);
  g.money = 1e7;
  for (const id of ['440600', '440100', '441600', '530100', '532900', '450100', '460100']) {
    g.unlockCity(id);
    g.addCityStations(id, 4);
  }
  total += g.stations.length;
  for (const s of g.stations) if (isWater(s.x, s.z)) waterStations++;
  const rnd = mulberry(round + 9);
  for (let i = 0; i < 150; i++) {
    try {
      const op = rnd();
      const lines = g.lines;
      if (op < 0.3 || !lines.length) {
        const a = g.stations[Math.floor(rnd() * g.stations.length)];
        const b = g.stations[Math.floor(rnd() * g.stations.length)];
        if (a && b && a.id !== b.id) {
          const l = g.createLine(a.id, b.id);
          if (l) for (const br of l.bridges) kinds[br.kind] = (kinds[br.kind] || 0) + 1;
        }
      } else if (op < 0.55) {
        const l = lines[Math.floor(rnd() * lines.length)];
        const s = g.stations[Math.floor(rnd() * g.stations.length)];
        if (s && rnd() < 0.5) {
          const before = l.bridges.length;
          if (g.extendLine(l.id, 'tail', s.id)) for (const br of l.bridges.slice(before)) kinds[br.kind]++;
        } else if (s) {
          const before = l.bridges.length;
          if (g.insertStation(l.id, Math.floor(rnd() * Math.max(1, l.stations.length - 1)), s.id))
            for (const br of l.bridges.slice(before)) kinds[br.kind]++;
        }
      } else if (op < 0.7) {
        const l = lines[Math.floor(rnd() * lines.length)];
        if (l.stations.length > 2) g.removeStationFromLine(l.id, l.stations[1]);
      } else if (op < 0.8) {
        const l = lines[Math.floor(rnd() * lines.length)];
        g.addTrain(l.id); g.addCar(l.id);
      } else if (op < 0.9) {
        g.update(1.1);
      } else {
        g.removeLine(lines[Math.floor(rnd() * lines.length)].id);
      }
    } catch (e) { bad++; console.log('FAIL', e && e.message); }
  }
}
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
console.log('stations', total, 'waterStations', waterStations, 'exceptions', bad, 'bridges', kinds);
