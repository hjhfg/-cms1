import fs from 'fs';
const meta = JSON.parse(fs.readFileSync('src/data/provinces.json', 'utf8'));
const Q = meta.quant;
const R = 6371.0088, D2R = Math.PI/180, LON0 = 105.0, LAT0 = 30.0;
const project = (lon, lat) => {
  const phi = lat*D2R;
  return [R*(lon-LON0)*D2R*Math.cos(phi), -R*(lat-LAT0)*D2R];
};
function readVarint(buf, st){let n=0,s=0;for(;;){const b=buf[st.p++];n|=(b&0x7f)<<s;if(!(b&0x80))break;s+=7;}return (n>>>1)^-(n&1);}
function readU32(buf,st){const v=buf[st.p]|(buf[st.p+1]<<8)|(buf[st.p+2]<<16)|(buf[st.p+3]<<24);st.p+=4;return v>>>0;}
function decode(buf, cm) {
  const st={p:cm.o}, end=cm.o+cm.l, polys=[];
  while(st.p<end){
    const nr=readU32(buf,st), rings=[];
    for(let r=0;r<nr;r++){
      const np=readU32(buf,st), ring=new Array(np);
      let qx=0,qy=0;
      for(let i=0;i<np;i++){qx+=readVarint(buf,st);qy+=readVarint(buf,st);ring[i]=project(qx/Q,qy/Q);}
      rings.push(ring);
    }
    polys.push(rings);
  }
  return polys;
}
console.log('元数据:', JSON.stringify(meta.stats));
let totalPts=0, totalCounties=0, totalMs=0;
const results=[];
for (const p of meta.provinces) {
  const t0=performance.now();
  const buf=new Uint8Array(fs.readFileSync('dist/geo/'+p.geo));
  let pts=0;
  for (const cm of p.index) {
    const polys=decode(buf,cm);
    for (const poly of polys) for (const ring of poly) pts+=ring.length;
    totalCounties++;
  }
  const ms=performance.now()-t0;
  totalMs+=ms; totalPts+=pts;
  results.push({name:p.name, ms:+ms.toFixed(1), pts, kb:Math.round(buf.length/1024)});
}
results.sort((a,b)=>b.ms-a.ms);
console.log(`\n解码 ${totalCounties} 区县 / ${totalPts.toLocaleString()} 点 / 共 ${totalMs.toFixed(0)} ms`);
console.log('最慢 5 省:');
for (const r of results.slice(0,5)) console.log(`  ${r.name}: ${r.ms} ms, ${r.pts.toLocaleString()} 点, ${r.kb} KB`);
console.log(`\n平均每省 ${(totalMs/meta.provinces.length).toFixed(1)} ms`);
