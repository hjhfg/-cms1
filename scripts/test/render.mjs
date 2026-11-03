/**
 * 软件光栅化验证：不依赖 GPU，直接把场景里的三角形投影到 2D 画布，
 * 用顶点色/材质色填充，输出 PNG。
 * 目的不是追求画质，而是确认「省份有不同颜色、陆地不被海盖住」。
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { createCanvas } from '@napi-rs/canvas';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url:'http://localhost:5180/', pretendToBeVisual:true });
const win = dom.window;
globalThis.window = win; globalThis.document = win.document;
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.location = win.location;
globalThis.HTMLElement = win.HTMLElement; globalThis.Element = win.Element; globalThis.Node = win.Node;
globalThis.getComputedStyle = win.getComputedStyle;
globalThis.self = globalThis;
globalThis.innerWidth = 900; globalThis.innerHeight = 1200; globalThis.devicePixelRatio = 1;
globalThis.localStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} };
globalThis.requestAnimationFrame = ()=>0;
globalThis.cancelAnimationFrame = ()=>{};
globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.matchMedia = () => ({matches:false,addEventListener(){},removeEventListener(){}});

// canvas：几何用 napi-rs，纹理绘制用简单实现
win.HTMLCanvasElement.prototype.getContext = function(type){
  if (/webgl/i.test(type)) return null;
  const real = createCanvas(Math.max(1,this._w||300), Math.max(1,this._h||150));
  const ctx = real.getContext('2d');
  // 代理，保证 canvas 尺寸变化时同步
  return new Proxy(ctx, { get(t,k){ return typeof t[k]==='function'? t[k].bind(t) : t[k]; } });
};
Object.defineProperty(win.HTMLCanvasElement.prototype,'width',{get(){return this._w??300;},set(v){this._w=v;},configurable:true});
Object.defineProperty(win.HTMLCanvasElement.prototype,'height',{get(){return this._h??150;},set(v){this._h=v;},configurable:true});

const meta = JSON.parse(fs.readFileSync('src/data/provinces.json','utf8'));
globalThis.fetch = async (url) => {
  let p = String(url).replace(/^\//,'');
  if (!p.startsWith('geo/')) p = 'geo/' + p.split('/').pop();
  const fp = 'public/' + p;
  if (!fs.existsSync(fp)) return { ok:false, status:404, arrayBuffer: async()=>new ArrayBuffer(0) };
  const b = fs.readFileSync(fp);
  return { ok:true, status:200, arrayBuffer: async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) };
};

// ---- 直接解码几何（绕开 World，验证「数据 → 屏幕」这条链路） ----
const { loadProvince } = await import('../../src/game/geoLoader.ts');
const { project } = await import('../../src/game/project.ts');

// 载入珠三角：广东 + 香港 + 澳门
const ids = ['440000','810000','820000'];
const loaded = [];
for (const id of ids) loaded.push(await loadProvince(id));

// 相机：看向佛山
const { CITIES } = await import('../../src/data/regions.ts');
const start = CITIES.find(c=>c.startUnlocked);
const st = start.stations[0];
const [cx, cz] = project(st.lon, st.lat);
const camDist = 420;          // 约 290 km 视野：珠三角 + 港澳 + 粤东粤西一部分
const FOV = 38;
const W = 900, H = 1200;
const tanH = Math.tan(FOV*Math.PI/360);
const viewH = 2*camDist*tanH;      // 世界可视高度(km)
const viewW = viewH * (W/H);
const pxPerKm = H / viewH;

const cv = createCanvas(W,H);
const ctx = cv.getContext('2d');
ctx.fillStyle = '#0d1a24';  // 海
ctx.fillRect(0,0,W,H);

// 省份配色（与 world.ts 同算法）
function provColor(id){ let h=0; for(const ch of id) h=(h*31+ch.charCodeAt(0))%100003;
  const hue=(h*137.508)%360, sat=34+(h%22), lig=44+(h%14);
  return `hsl(${hue}, ${sat}%, ${lig}%)`; }

const toScreen = (x,z) => [ (x-cx)*pxPerKm + W/2, (z-cz)*pxPerKm + H/2 ];

let drawn = 0;
// 按地级市上色（与 world.ts buildProvinceLand 同算法）
for (const pg of loaded) {
  const byCity = new Map();
  for (const c of pg.counties) {
    const k = c.meta.c || pg.id;
    if (!byCity.has(k)) byCity.set(k, []);
    byCity.get(k).push(c);
  }
  let idx = 0;
  for (const [cityName, counties] of byCity) {
    let h = 0;
    for (let i = 0; i < cityName.length; i++) h = (h * 31 + cityName.charCodeAt(i)) % 100003;
    const hue = (h * 137.508 + idx * 11) % 360;
    const sat = 30 + (h % 24);
    const lig = 46 + (h % 16);
    ctx.fillStyle = `hsl(${hue.toFixed(1)}, ${sat}%, ${lig}%)`;
    idx++;
    for (const c of counties) {
      for (const poly of c.polys) {
        if (!poly.length) continue;
        ctx.beginPath();
        const ring = poly[0];
        let anyIn = false;
        for (let i = 0; i < ring.length; i++) {
          const [sx, sy] = toScreen(ring[i][0], ring[i][1]);
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          if (sx > -200 && sx < W + 200 && sy > -200 && sy < H + 200) anyIn = true;
        }
        ctx.closePath();
        if (!anyIn) continue;
        ctx.fill();
        ctx.strokeStyle = 'rgba(40,30,20,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        drawn++;
      }
    }
  }
}
console.log(`绘制 ${drawn} 个多边形`);
console.log(`视野: ${(viewW).toFixed(1)} × ${(viewH).toFixed(1)} km, 中心 佛山 (${cx.toFixed(1)}, ${cz.toFixed(1)})`);

// 统计非海像素占比（判断陆地是否可见）
const img = ctx.getImageData(0,0,W,H);
let landPx=0, total=W*H;
for (let i=0;i<total;i++){
  const r=img.data[i*4], g=img.data[i*4+1], b=img.data[i*4+2];
  // 海色 #0d1a24 (13,26,36)
  if (Math.abs(r-13)>12 || Math.abs(g-26)>12 || Math.abs(b-36)>12) landPx++;
}
console.log(`陆地像素占比: ${(landPx/total*100).toFixed(1)}%`);

fs.writeFileSync('scripts/test/render.png', cv.toBuffer('image/png'));
console.log('已输出 scripts/test/render.png');
