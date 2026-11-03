import { JSDOM } from 'jsdom';
import fs from 'fs';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url:'http://localhost:5180/', pretendToBeVisual:true });
const win = dom.window;
globalThis.window = win; globalThis.document = win.document;
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.location = win.location;
globalThis.HTMLElement = win.HTMLElement; globalThis.Element = win.Element; globalThis.Node = win.Node;
globalThis.getComputedStyle = win.getComputedStyle;
globalThis.self = globalThis;
globalThis.innerWidth = 1280; globalThis.innerHeight = 800; globalThis.devicePixelRatio = 1;
globalThis.localStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} };
globalThis.requestAnimationFrame = (cb)=>setTimeout(()=>cb(Date.now()),16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.matchMedia = () => ({matches:false,addEventListener(){},removeEventListener(){}});

globalThis.fetch = async (url) => {
  let p = String(url).replace(/^\//,'');
  if (!p.startsWith('geo/')) p = 'geo/' + p.split('/').pop();
  const fp = 'public/' + p;
  if (!fs.existsSync(fp)) return { ok:false, status:404, arrayBuffer: async()=>new ArrayBuffer(0) };
  const b = fs.readFileSync(fp);
  return { ok:true, status:200, arrayBuffer: async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) };
};

function fakeGL(){
  const t={canvas:null,drawingBufferWidth:1280,drawingBufferHeight:800,getExtension:()=>null,
    getParameter:(p)=>{if(p===7936||p===37445)return'Fake';if(p===7937||p===37446)return'FakeGL';if(p===7938)return'WebGL 2.0';if(p===35724)return'WebGL GLSL ES 3.00';return 4096;},
    getShaderPrecisionFormat:()=>({precision:23,rangeMin:127,rangeMax:127}),getContextAttributes:()=>({}),
    getSupportedExtensions:()=>[],getProgramParameter:()=>true,getShaderParameter:()=>true,
    getProgramInfoLog:()=>'',getShaderInfoLog:()=>'',getUniformLocation:()=>({}),getAttribLocation:()=>0,
    getActiveUniform:()=>({name:'u',type:5126,size:1}),getActiveAttrib:()=>({name:'a',type:5126,size:1}),
    checkFramebufferStatus:()=>36053,isContextLost:()=>false,getError:()=>0};
  return new Proxy(t,{get(o,k){if(k in o)return o[k];if(/^[A-Z0-9_]+$/.test(k)){const C={VERSION:7938,SHADING_LANGUAGE_VERSION:35724,VENDOR:7936,RENDERER:7937,MAX_TEXTURE_SIZE:3379,MAX_SAMPLES:36183,MAX_COLOR_ATTACHMENTS:36063,MAX_DRAW_BUFFERS:34852};return C[k]??0;}return()=>({});},set(o,k,v){o[k]=v;return true;}});
}
win.HTMLCanvasElement.prototype.getContext = function(type){
  if(/webgl2/i.test(type)){const g=fakeGL();g.canvas=this;return g;}
  if(/webgl/i.test(type))return null;
  const n=()=>{};
  return {canvas:this,fillStyle:'#000',strokeStyle:'#000',globalAlpha:1,lineWidth:1,
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),
    getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(Math.max(1,w*h*4)),width:w,height:h}),
    putImageData:n,drawImage:n,fillRect:n,clearRect:n,strokeRect:n,beginPath:n,closePath:n,moveTo:n,lineTo:n,
    arc:n,ellipse:n,rect:n,roundRect:n,bezierCurveTo:n,quadraticCurveTo:n,fill:n,stroke:n,clip:n,save:n,restore:n,
    translate:n,rotate:n,scale:n,setTransform:n,resetTransform:n,createLinearGradient:()=>({addColorStop:n}),
    createRadialGradient:()=>({addColorStop:n}),createPattern:()=>({}),measureText:(t)=>({width:t.length*6}),
    fillText:n,strokeText:n,setLineDash:n,getLineDash:()=>[]};
};
Object.defineProperty(win.HTMLCanvasElement.prototype,'width',{get(){return this._w??300;},set(v){this._w=v;},configurable:true});
Object.defineProperty(win.HTMLCanvasElement.prototype,'height',{get(){return this._h??150;},set(v){this._h=v;},configurable:true});

const errors=[];
win.addEventListener('error', e=>errors.push('winderr: '+(e.message||e.error)));
process.on('uncaughtException', e=>errors.push('uncaught: '+e.message+'\n'+(e.stack||'').split('\n').slice(1,4).join('\n')));
process.on('unhandledRejection', e=>errors.push('reject: '+(e?.message||e)));

const THREE = await import('three');
THREE.PMREMGenerator.prototype.fromScene = function(){ return {texture:new THREE.Texture()}; };

console.log('[1] 构造 Game...');

const { Game } = await import('../../src/game/engine.ts');
const g = new Game();
const { World } = await import('../../src/game/world.ts');
const w = new World(g, dom.window.document.createElement('canvas'));

const CENTER = { tx: 807.3, tz: 761.0 };
const camDist = Number(process.argv[2] || 420);
for (let f = 0; f < 70; f++) {
  w.update({ dt: 1/60, ...CENTER, dist: camDist, pxWorld: 1, selectedLine: null, camPos: {x:0,y:1,z:0} });
  await new Promise(r=>setTimeout(r,22));
}
w.updateRegionColors();

const { createCanvas } = await import('@napi-rs/canvas');
const W = 900, H = 900;
const out = createCanvas(W, H);
const ctx = out.getContext('2d');
ctx.fillStyle = '#0b1a26';
ctx.fillRect(0, 0, W, H);

// 与 view.ts 同构的正交近似：把世界公里映射到屏幕
const viewH = 2 * camDist * Math.tan((22.5 * Math.PI) / 180);
const pw = viewH / H;
const toS = (x, z) => [ (x - CENTER.tx) / pw + W/2, (z - CENTER.tz) / pw + H/2 ];

let polys = 0;
const seen = new Set();
const v = new THREE.Vector3();
for (const [, grp] of w.landGroups) {
  grp.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    const col = '#' + o.material.color.getHexString();
    seen.add(col);
    // ShapeGeometry 已 rotateX(-PI/2)：x → 世界 x, y → 世界 z
    const idx = o.geometry.getIndex();
    ctx.fillStyle = col;
    ctx.strokeStyle = 'rgba(30,24,16,0.45)';
    ctx.lineWidth = 0.6;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i;
      const b = idx ? idx.getX(i+1) : i+1;
      const c = idx ? idx.getX(i+2) : i+2;
      const [ax, ay] = toS(pos.getX(a), pos.getZ(a));
      const [bx, by] = toS(pos.getX(b), pos.getZ(b));
      const [cx, cy] = toS(pos.getX(c), pos.getZ(c));
      if (Math.max(ax,bx,cx) < -20 || Math.min(ax,bx,cx) > W+20) continue;
      if (Math.max(ay,by,cy) < -20 || Math.min(ay,by,cy) > H+20) continue;
      // 外扩 0.5px 吃掉落缝：three.js 里同一网格的相邻三角形共享顶点，
      // 不会像逐三角形填充那样露出背景线。
      const mx = (ax+bx+cx)/3, my = (ay+by+cy)/3;
      const gx = (x) => x + Math.sign(x-mx)*0.55, gy = (y) => y + Math.sign(y-my)*0.55;
      ctx.beginPath();
      ctx.moveTo(gx(ax), gy(ay)); ctx.lineTo(gx(bx), gy(by)); ctx.lineTo(gx(cx), gy(cy));
      ctx.closePath(); ctx.fill();
    }
    polys++;
  });
}
console.log(`camDist=${camDist} 视野 ${viewH.toFixed(0)}km  陆地网格 ${polys}  唯一颜色 ${seen.size}`);
console.log('颜色样例:', [...seen].slice(0, 10).join(' '));
fs.writeFileSync('scripts/test/land.png', out.toBuffer('image/png'));
console.log('已输出 scripts/test/land.png');
