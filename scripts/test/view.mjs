import fs from 'fs';
const meta = JSON.parse(fs.readFileSync('src/data/provinces.json','utf8'));
const R=6371.0088, D2R=Math.PI/180, LON0=105.0, LAT0=30.0;
const project=(lon,lat)=>{const phi=lat*D2R;return [R*(lon-LON0)*D2R*Math.cos(phi), -R*(lat-LAT0)*D2R];};

// 复刻 provinceBBox
const boxes = {};
for (const p of meta.provinces) {
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  for (const c of p.index) {
    if (!c.cp) continue;
    const [x,z]=project(c.cp[0],c.cp[1]);
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);
    minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
  }
  const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2;
  const hw=(maxX-minX)*0.62+60, hh=(maxZ-minZ)*0.62+60;
  boxes[p.name]={minX:cx-hw,maxX:cx+hw,minZ:cz-hh,maxZ:cz+hh};
}
// 全国范围
let a={minX:1e9,maxX:-1e9,minZ:1e9,maxZ:-1e9};
for(const b of Object.values(boxes)){a.minX=Math.min(a.minX,b.minX);a.maxX=Math.max(a.maxX,b.maxX);a.minZ=Math.min(a.minZ,b.minZ);a.maxZ=Math.max(a.maxZ,b.maxZ);}
console.log('全国包围盒:', {minX:Math.round(a.minX),maxX:Math.round(a.maxX),minZ:Math.round(a.minZ),maxZ:Math.round(a.maxZ)});
console.log('宽度', Math.round(a.maxX-a.minX), 'km, 高度', Math.round(a.maxZ-a.minZ), 'km');

for (const [dist, viewR] of [[7000, 15400], [7000, 900], [1900, 4180]]) {
  const want=[];
  for (const [n,b] of Object.entries(boxes)) {
    if (b.maxX < -viewR || b.minX > viewR || b.maxZ < -viewR || b.minZ > viewR) continue;
    want.push(n);
  }
  console.log(`dist=${dist} viewR=${viewR}: 命中 ${want.length} 省 — ${want.slice(0,8).join(',')}${want.length>8?'...':''}`);
}
