console.log('A: 开始');
try {
  const m = await import('../../src/game/geoLoader.ts');
  console.log('B: import ok, keys=', Object.keys(m).join(','));
  console.log('C: stats=', JSON.stringify(m.GEO_META.stats));
} catch (e) {
  console.log('ERR:', e.message);
  console.log(e.stack?.split('\n').slice(0,6).join('\n'));
}
console.log('D: 结束');
