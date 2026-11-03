#!/usr/bin/env python3
"""
从 provinces.json 生成全国城市清单（regions.ts）

规则（按 mini metro 玩法调整）：
  · 每个地级市 = 一个 City
  · 该市的区县中心点 = 候选站点池（真实经纬度）
  · tier(站点等级) 依据：直辖市/省会/计划单列市 → 3；地级市 → 2；其余 → 1
  · 每市首个站标注 star（枢纽）
"""
import json, os, sys

META = 'src/data/provinces.json'
OUT = 'src/data/regions.ts'

# 省会 / 直辖市 / 计划单列市：tier 3
TIER3 = {
    '110000','120000','310000','500000',            # 直辖市
    '440100','440300',                              # 广州 深圳
    '330100','320100','510100','420100','430100',    # 杭州 南京 成都 武汉 长沙
    '610100','370100','370200','410100','340100',    # 西安 济南 青岛 郑州 合肥
    '350200','350100','360100','530100','450100',    # 厦门 福州 南昌 昆明 南宁
    '460100','520100','620100','630100','640100',    # 海口 贵阳 兰州 西宁 银川
    '650100','210100','220100','230100','140100',    # 乌鲁木齐 沈阳 长春 哈尔滨 太原
    '130100','710100','810000','820000',            # 石家庄 台北 香港 澳门
}
TIER2_EXTRA = {'441900','442000','460200','469001'}  # 东莞 中山 三亚 等

def main():
    meta = json.load(open(META, encoding='utf-8'))
    provs = meta['provinces']

    lines = []
    A = lines.append
    A("// 本文件由 scripts/gen-cities.py 自动生成，请勿手改")
    A("// 数据源：echarts-china-counties-js（真实行政区划边界 + 区县中心点）")
    A("")
    A("export type Shape = 'circle' | 'triangle' | 'square' | 'diamond' | 'pentagon' | 'star' | 'cross';")
    A("")
    A("export interface StationDef {")
    A("  name: string;")
    A("  lon: number;")
    A("  lat: number;")
    A("  tier: 1 | 2 | 3;")
    A("  shape?: Shape;")
    A("}")
    A("")
    A("export interface CityDef {")
    A("  id: string;")
    A("  name: string;")
    A("  short: string;")
    A("  color: string;")
    A("  province: string;")
    A("  stations: StationDef[];")
    A("  startUnlocked?: boolean;")
    A("}")
    A("")
    A("// 起始只开放佛山（按市名匹配：生成时 ID 会重新编号，硬编码 ID 会失效）")
    A("const START_CITY_NAMES = new Set(['佛山市']);")
    A("")
    A("export const CITIES: CityDef[] = [")

    total_cities = 0
    total_stations = 0

    for p in provs:
        pid = p['id']
        pname = p['name']

        # 按真实地级市归属分组（index 里的 'c' 字段来自原始目录层级）
        from collections import OrderedDict
        groups = OrderedDict()
        for c in p['index']:
            city = c.get('c') or '本级'
            groups.setdefault(city, []).append(c)

        for cityname, cl in groups.items():
            total_cities += 1
            cid = f"{pid[:2]}{total_cities:04d}"
            stations = []
            for i, c in enumerate(cl):
                if not c['cp']:
                    continue
                lon, lat = c['cp']
                tier = 3 if pid in TIER3 else (2 if (pid in TIER2_EXTRA or len(cl) >= 8) else 1)
                shape = 'star' if i == 0 else None
                stations.append((c['n'], lon, lat, tier, shape))
            if not stations:
                continue
            total_stations += len(stations)
            short = cityname.replace('市', '').replace('地区', '').replace('自治州', '')
            A(f"  {{ id: '{cid}', name: '{cityname}', short: '{short}', color: '#8a8f96', province: '{pid}',")
            A(f"    stations: [")
            for nm, lon, lat, tier, shape in stations:
                sh = f", shape: '{shape}'" if shape else ''
                A(f"      {{ name: '{nm}', lon: {lon}, lat: {lat}, tier: {tier}{sh} }},")
            A(f"    ] }},")

    A("];")
    A("")
    A("// 起始解锁（迷你地铁逻辑：开局只给一座城市）")
    A("for (const c of CITIES) if (START_CITY_NAMES.has(c.name)) c.startUnlocked = true;")
    A("")
    A("export const LINE_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#ec407a'];")
    A("export const LINE_NAMES = ['1号线', '2号线', '3号线', '4号线', '5号线', '6号线', '7号线', '8号线'];")
    A("")

    open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f"生成 {OUT}: {total_cities} 市 / {total_stations} 站")

if __name__ == '__main__':
    main()
