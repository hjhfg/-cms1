#!/usr/bin/env python3
"""
数据管线：echarts-china-counties-js → 紧凑瓦片化二进制

优化链：
  原始 GeoJSON  ~233 MB
  → 量化到 1/4096 度 (≈27 m)
  → Douglas-Peucker 简化，容差 0.001° (≈111 m，图上不可见)
  → delta 编码 + zigzag varint（相邻点增量通常很小）
  ≈ 原始点集的 5%

产物：
  src/data/provinces.json   省级元数据 + 区县索引（首屏必需）
  public/geo/<省>.geo       每省几何（自定义二进制，按需 fetch）
"""
import os, json, sys, glob, math

SRC = 'node_modules/echarts-china-counties-js/src'
OUT_JSON = 'src/data/provinces.json'
OUT_GEO = 'public/geo'
QUANT = 4096          # 1/4096 度 ≈ 27 m
TOL = 0.001           # 简化容差 ≈ 111 m

PROV_CODE = {
    '北京':'110000','天津':'120000','河北':'130000','山西':'140000','内蒙古':'150000',
    '辽宁':'210000','吉林':'220000','黑龙江':'230000','上海':'310000','江苏':'320000',
    '浙江':'330000','安徽':'340000','福建':'350000','江西':'360000','山东':'370000',
    '河南':'410000','湖北':'420000','湖南':'430000','广东':'440000','广西':'450000',
    '海南':'460000','重庆':'500000','四川':'510000','贵州':'520000','云南':'530000',
    '西藏':'540000','陕西':'610000','甘肃':'620000','青海':'630000','宁夏':'640000',
    '新疆':'650000','台湾':'710000','香港':'810000','澳门':'820000',
}

# ---------- Douglas-Peucker ----------
def dp(pts, tol):
    if len(pts) < 3:
        return pts
    x1, y1 = pts[0]; x2, y2 = pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = math.hypot(px - x1, py - y1) if L == 0 else abs(dy * px - dx * py + x2 * y1 - y2 * x1) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        left = dp(pts[:idx + 1], tol)
        right = dp(pts[idx:], tol)
        return left[:-1] + right
    return [pts[0], pts[-1]]

# ---------- zigzag varint ----------
def put_varint(out, n):
    n = (n << 1) ^ (n >> 63)          # zigzag（python 任意精度，负数右移仍为负，异或得正）
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            break

def write_u32(out, v):
    out += v.to_bytes(4, 'little')

def rings_of(geom):
    t = geom['type']
    cs = geom['coordinates']
    if t == 'Polygon':
        return [cs]
    if t == 'MultiPolygon':
        return cs
    return []

def main():
    os.makedirs(OUT_GEO, exist_ok=True)
    provinces, total_pts_raw, total_pts, total_counties, total_bytes = [], 0, 0, 0, 0

    for pdirname in sorted(os.listdir(SRC)):
        pdir = os.path.join(SRC, pdirname)
        if not os.path.isdir(pdir):
            continue
        subdirs = sorted([d for d in os.listdir(pdir) if os.path.isdir(os.path.join(pdir, d))])
        prov_units = [(d, os.path.join(pdir, d)) for d in subdirs] if pdirname == '直辖市' \
                     else [(pdirname, pdir)]

        for pname, ppath in prov_units:
            code = PROV_CODE.get(pname)
            if not code:
                print(f'  ! 未知省级单位 {pname}', file=sys.stderr)
                continue

            blob = bytearray()
            idx = []
            cities = []

            direct = sorted(glob.glob(os.path.join(ppath, '*.geojson')))
            citynames = sorted([d for d in os.listdir(ppath) if os.path.isdir(os.path.join(ppath, d))])
            groups = [(c, os.path.join(ppath, c)) for c in citynames]
            if direct:
                groups.insert(0, ('本级', ppath))

            for cname, cpath in groups:
                files = sorted(glob.glob(os.path.join(cpath, '*.geojson')))
                if not files:
                    continue
                ccount = 0
                for fp in files:
                    try:
                        d = json.load(open(fp, encoding='utf-8'))
                    except Exception:
                        continue
                    if not d.get('features'):
                        continue
                    ft = d['features'][0]
                    geom = ft.get('geometry')
                    if not geom:
                        continue
                    props = ft.get('properties') or {}
                    name = props.get('name') or os.path.basename(fp)[:-8]
                    cp = props.get('cp')
                    polys = rings_of(geom)
                    if not polys:
                        continue

                    # ---- 单区县编码 ----
                    before = len(blob)
                    body = bytearray()
                    npoly = 0
                    for poly in polys:
                        rings = []
                        for r in poly:
                            if len(r) < 3:
                                continue
                            total_pts_raw += len(r)
                            s = dp(r, TOL)
                            if len(s) < 3:
                                continue
                            rings.append(s)
                        if not rings:
                            continue
                        write_u32(body, len(rings))
                        for s in rings:
                            write_u32(body, len(s))
                            px = py = 0
                            for lon, lat in s:
                                x = int(round(lon * QUANT))
                                y = int(round(lat * QUANT))
                                put_varint(body, x - px)
                                put_varint(body, y - py)
                                px, py = x, y
                            total_pts += len(s)
                        npoly += 1
                    if npoly == 0:
                        continue

                    idx.append({
                        'n': name,
                        'c': cname,                     # 所属地级市（真实层级，非聚类）
                        'cp': [round(cp[0], 4), round(cp[1], 4)] if cp else None,
                        'p': npoly,
                        'o': before,
                        'l': len(body),
                    })
                    blob += body
                    ccount += 1
                    total_counties += 1
                if ccount:
                    cities.append({'name': cname, 'counties': ccount})

            if not idx:
                continue

            fn = f'{code}.geo'
            with open(os.path.join(OUT_GEO, fn), 'wb') as f:
                f.write(blob)
            total_bytes += len(blob)

            provinces.append({
                'id': code, 'name': pname,
                'cities': len(cities), 'counties': len(idx),
                'geo': fn, 'bytes': len(blob),
                'index': idx,
            })
            print(f'  {pname}({code}): {len(cities)} 市 / {len(idx)} 区县 / {len(blob)/1024:.0f} KB')

    meta = {
        'version': 1, 'quant': QUANT, 'tol': TOL,
        'provinces': provinces,
        'stats': {
            'provinces': len(provinces),
            'cities': sum(p['cities'] for p in provinces),
            'counties': total_counties,
            'rawPoints': total_pts_raw,
            'points': total_pts,
            'geoBytes': total_bytes,
        },
    }
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))

    st = meta['stats']
    print(f"\n汇总: {st['provinces']} 省级 / {st['cities']} 市 / {st['counties']} 区县")
    print(f"      点数 {st['rawPoints']:,} → {st['points']:,} ({st['points']/st['rawPoints']*100:.0f}%)")
    print(f"      几何 {st['geoBytes']/1024/1024:.1f} MB / 元数据 {os.path.getsize(OUT_JSON)/1024:.0f} KB")

if __name__ == '__main__':
    main()
