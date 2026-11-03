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

process.on('exit', c => { if (errors.length) console.log('EXIT ERRORS:', errors.slice(0,3)); });
console.log('[1] 构造 Game...');

const { Game } = await import('../../src/game/engine.ts');
const g = new Game();
console.log('    城市', g.cities.length, '/ 站点', g.stations.length);
const worldMod = await import('../../src/game/world.ts').catch(e => { console.log('WORLD IMPORT FAIL:', e.message, (e.stack||'').split('\n').slice(0,5).join(' | ')); throw e; });
const World = worldMod.World;
const w = new World(g, dom.window.document.createElement('canvas'));
for (let f = 0; f < 60; f++) {
  w.update({ dt: 1/60, tx: 807.3, tz: 761.0, dist: 420, pxWorld: 1, selectedLine: null, camPos: {x:0,y:1,z:0} });
  await new Promise(r=>setTimeout(r,25));
}
console.log('已构建省:', w.builtProvinces.size, ' landGroups:', w.landGroups.size);
let meshes = 0; const colors = new Set();
for (const [, grp] of w.landGroups) grp.traverse(o=>{ if (o.isMesh) { meshes++; colors.add(o.material.color.getHexString()); } });
console.log('陆地 Mesh 数:', meshes, '唯一颜色数:', colors.size);
w.updateRegionColors();
let colored = 0, grey = 0; const after = new Set();
for (const [, grp] of w.landGroups) grp.traverse(o=>{
  if (!o.isMesh) return;
  const h = o.material.color.getHexString(); after.add(h);
  if (h === '7a8266' || h === '7a8288' || h === '7a7d80' || h === 'ffffff') grey++; else colored++;
});
console.log('updateRegionColors 后 → 有色:', colored, ' 灰/白:', grey, ' 唯一颜色:', after.size);
console.log('样例:', [...after].slice(0,8).join(', '));
