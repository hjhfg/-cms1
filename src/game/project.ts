// 投影定义独立成模块，打破 geo.ts ↔ geoLoader.ts 的循环依赖。
// 循环依赖在 Vite 构建时不会报错，但运行时会让其中一方拿到 undefined。

export const R_EARTH = 6371.0088;
export const LON0 = 105.0;   // 全国视野中心
export const LAT0 = 30.0;
const D2R = Math.PI / 180;

/** 正弦投影：1 单位 = 1 公里 */
export function project(lon: number, lat: number): [number, number] {
  const phi = lat * D2R;
  return [
    R_EARTH * (lon - LON0) * D2R * Math.cos(phi),
    -R_EARTH * (lat - LAT0) * D2R,
  ];
}

export function unproject(x: number, z: number): [number, number] {
  const lat = LAT0 - z / (R_EARTH * D2R);
  const phi = lat * D2R;
  const lon = LON0 + x / (R_EARTH * D2R * Math.cos(phi));
  return [lon, lat];
}
