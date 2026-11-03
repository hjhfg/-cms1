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
console.log(`    城市 ${g.cities.length} / 站点 ${g.stations.length}`);

console.log('[2] 构造 World...');
const { World } = await import('../../src/game/world.ts');
const renderer = {
  capabilities:{isWebGL2:true,getMaxAnisotropy:()=>4,maxTextureSize:4096},
  getRenderTarget:()=>null,setRenderTarget:()=>{},clear:()=>{},
  getSize:(v)=>v.set(1280,800),setSize:()=>{},compile:()=>{},dispose:()=>{},
  info:{memory:{},render:{}},shadowMap:{enabled:true,type:0},
  outputColorSpace:'srgb',toneMapping:0,toneMappingExposure:1,
  getClearColor:(c)=>(c?c.set(0,0,0):new THREE.Color()),getClearAlpha:()=>1,setClearAlpha:()=>{},
  autoClear:true,domElement:{width:1280,height:800},xr:{enabled:false},
};
const t0 = Date.now();
const w = new World(g, 'mid', renderer);
console.log(`    World 构造 ${Date.now()-t0} ms`);

console.log('[3] 等待流式加载...');
for (let i = 0; i < 60; i++) {
  try {
    w.update({dt:0.016,tx:0,tz:0,dist:7000,pxWorld:1,selectedLine:null,camPos:new THREE.Vector3(0,7000,7000)});
  } catch(e) {
    console.log('  update 抛错 @'+i+':', e.message);
    console.log((e.stack||'').split('\n').slice(1,5).join('\n'));
    break;
  }
  await new Promise(r=>setTimeout(r,50));
  if (i%15===0) console.log(`  帧 ${i}: 已加载 ${w.landStats.loaded}, 构建 ${w.landStats.built}, 请求 ${w.landStats.requests}, loading集 ${w.loadingProvinces?.size}`);
}
console.log('  循环结束, 异常:', errors.slice(0,3));
let meshes=0,verts=0;
w.scene.traverse(o=>{if(o.isMesh){meshes++;const p=o.geometry?.attributes?.position;if(p)verts+=p.count;}});
console.log(`    场景: ${meshes} Mesh, ${(verts/1000).toFixed(0)}k 顶点`);
console.log(`    已加载省: ${w.landStats.loaded}, 已构建: ${w.landStats.built}, 请求数: ${w.landStats.requests}`);
console.log(`    陆地网格: ${w.regionMeshes.size}, 边界线: ${w.borderMeshes?.length ?? 0}`);
console.log('[4] 异常:', errors.length ? errors.slice(0,4) : '无');
