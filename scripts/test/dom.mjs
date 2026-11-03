import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5180/', pretendToBeVisual: true,
});
const win = dom.window;
globalThis.window = win;
globalThis.document = win.document;
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
globalThis.location = win.location;
globalThis.HTMLElement = win.HTMLElement;
globalThis.Element = win.Element;
globalThis.Node = win.Node;
globalThis.getComputedStyle = win.getComputedStyle;
globalThis.self = globalThis;
globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
globalThis.devicePixelRatio = 1;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });

// fetch 从 dist/geo 读
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^\//, '').replace(/^geo\//, 'public/geo/');
  const p = u.startsWith('public/') ? u : path.join('dist', u);
  if (!fs.existsSync(p)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  const b = fs.readFileSync(p);
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength) };
};

// WebGL 垫片
function fakeGL() {
  const t = {
    canvas: null, drawingBufferWidth: 1280, drawingBufferHeight: 800,
    getExtension: () => null,
    getParameter: (p) => {
      if (p===7936||p===37445) return 'Fake';
      if (p===7937||p===37446) return 'FakeGL';
      if (p===7938) return 'WebGL 2.0';
      if (p===35724) return 'WebGL GLSL ES 3.00';
      return 4096;
    },
    getShaderPrecisionFormat: () => ({precision:23,rangeMin:127,rangeMax:127}),
    getContextAttributes: () => ({}),
    getSupportedExtensions: () => [],
    getProgramParameter: () => true, getShaderParameter: () => true,
    getProgramInfoLog: () => '', getShaderInfoLog: () => '',
    getUniformLocation: () => ({}), getAttribLocation: () => 0,
    getActiveUniform: () => ({name:'u',type:5126,size:1}),
    getActiveAttrib: () => ({name:'a',type:5126,size:1}),
    checkFramebufferStatus: () => 36053,
    isContextLost: () => false, getError: () => 0,
  };
  return new Proxy(t, {
    get(o,k){
      if(k in o) return o[k];
      if(/^[A-Z0-9_]+$/.test(k)) {
        const C={VERSION:7938,SHADING_LANGUAGE_VERSION:35724,VENDOR:7936,RENDERER:7937,MAX_TEXTURE_SIZE:3379,MAX_SAMPLES:36183,MAX_COLOR_ATTACHMENTS:36063,MAX_DRAW_BUFFERS:34852};
        return C[k] ?? 0;
      }
      return () => ({});
    },
    set(o,k,v){o[k]=v;return true;}
  });
}
win.HTMLCanvasElement.prototype.getContext = function(type){
  if(/webgl2/i.test(type)){const g=fakeGL();g.canvas=this;return g;}
  if(/webgl/i.test(type)) return null;
  const noop=()=>{};
  return {canvas:this,fillStyle:'#000',strokeStyle:'#000',globalAlpha:1,lineWidth:1,
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),
    getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(Math.max(1,w*h*4)),width:w,height:h}),
    putImageData:noop,drawImage:noop,fillRect:noop,clearRect:noop,strokeRect:noop,
    beginPath:noop,closePath:noop,moveTo:noop,lineTo:noop,arc:noop,ellipse:noop,rect:noop,roundRect:noop,
    bezierCurveTo:noop,quadraticCurveTo:noop,fill:noop,stroke:noop,clip:noop,save:noop,restore:noop,
    translate:noop,rotate:noop,scale:noop,setTransform:noop,resetTransform:noop,
    createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop}),
    createPattern:()=>({}),measureText:(t)=>({width:t.length*6}),fillText:noop,strokeText:noop,
    setLineDash:noop,getLineDash:()=>[]};
};
Object.defineProperty(win.HTMLCanvasElement.prototype,'width',{get(){return this._w??300;},set(v){this._w=v;},configurable:true});
Object.defineProperty(win.HTMLCanvasElement.prototype,'height',{get(){return this._h??150;},set(v){this._h=v;},configurable:true});

const errors=[];
process.on('uncaughtException', e => errors.push('uncaught: '+e.message));
process.on('unhandledRejection', e => errors.push('rejection: '+(e?.message||e)));

console.log('[1] 测试 geoLoader 解码...');
const __gl = await import('../../src/game/geoLoader.ts');
const { loadProvince, PROVINCES, GEO_META } = __gl;
console.log('    元数据:', JSON.stringify(GEO_META.stats));

const t0 = Date.now();
const gd = await loadProvince('440000');
console.log(`[2] 广东加载: ${gd.counties.length} 区县, ${Date.now()-t0} ms`);

// 验证坐标合理（中国范围 lon 73~135, lat 3~54）
let bad = 0, minLon=180, maxLon=-180, minLat=90, maxLat=-90;
for (const c of gd.counties.slice(0, 20)) {
  for (const poly of c.polys) for (const ring of poly) for (const [x,z] of ring) {
    // 反投影校验
    const lat = 30.0 - z/(6371.0088*Math.PI/180);
    if (!isFinite(x) || !isFinite(z) || Math.abs(x) > 8000 || Math.abs(z) > 8000) bad++;
    minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat);
  }
}
console.log(`[3] 坐标校验: 异常 ${bad}, 纬度范围 ${minLat.toFixed(1)}~${maxLat.toFixed(1)}`);
console.log('[4] 未捕获异常:', errors.length ? errors.slice(0,3) : '无');
