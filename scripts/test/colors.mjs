import fs from 'fs';
const meta = JSON.parse(fs.readFileSync('src/data/provinces.json','utf8'));
const gd = meta.provinces.find(p=>p.id==='440000');
console.log('广东区县数:', gd.index.length);
const byCity = new Map();
for (const c of gd.index) {
  const k = c.c || 'NONE';
  if (!byCity.has(k)) byCity.set(k, 0);
  byCity.set(k, byCity.get(k)+1);
}
console.log('市级分组数:', byCity.size);
console.log('分组:', [...byCity.entries()].slice(0,25).map(([k,v])=>k+'('+v+')').join(' '));
console.log();
// 检查色相分布
let i=0;
for (const [city] of byCity) {
  let h=0; for (let j=0;j<city.length;j++) h=(h*31+city.charCodeAt(j))%100003;
  const hue=(h*137.508 + i*11)%360;
  const sat=30+(h%24), lig=46+(h%16);
  console.log(`  ${city.padEnd(8)} hue=${hue.toFixed(0).padStart(3)} sat=${sat} lig=${lig}`);
  i++;
}
