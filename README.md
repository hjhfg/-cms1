# 迷你地铁 · 粤桂琼滇 2026

以真实经纬度 1:1 建模的南方地铁经营游戏：**广东（含港澳 23）· 广西 14 · 海南 18 · 云南 16 = 71 个地级行政区、408 个区县、4055 个镇街**。Three.js 渲染 3D 地形、江河水系与桥梁，按《迷你地铁》的规则拖拽铺线、疏导客流。

## 运行

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 构建为单个 dist/index.html（约 1.4 MB）
npm run preview  # 预览构建产物
```

## 玩法

- **开局在佛山**：只有佛山的少数站点开放；广州、深圳、南宁、昆明等要花资金「批准规划」后才开始生成车站与客流（城市面板可看每座城市的区县/镇街清单与解锁价）
- **站点是程序化生成的**：每局按真实区县与镇街随机布点、随机形状、随机命名（如「佛山·祖庙」「南海·大狮」），同一座城市每局都不一样，没有固定的四站
- **跨水自动建桥**：跨河 → 跨河大桥、跨江 → 跨江大桥、跨海 → 跨海大桥（斜拉桥塔 + 拉索 + 桥墩），桥面为拱形，列车沿拱过江；造价陆地 0.85/km、河 1.7、江 2.6、海 4.2，盾构科技只折跨海
- **36 条干流水系**：西江、北江、东江、珠江正干与珠三角网河（磨刀门/崖门/陈村/顺德/容桂/小榄/洪奇沥…）、韩江、鉴江、郁江、柳江、漓江、红水河、南渡江、金沙江、澜沧江、怒江、元江…… 独立 3D 水面（法线流动 + 清漆反射 + 河岸带）
- 乘客带形状标记，只去与自己形状相同的车站；换乘由引擎自动寻路；已接线车站只派送当前线网送得到的形状（未接线车站的乘客在接线时自动清场）
- 多线交汇自动升级为立体换乘枢纽；超容持续 `BAL.overSecs` 秒判负；台风 / 春运 / 广交会随机事件

## 结构

```
src/
  App.tsx            组合根：引擎生命周期 + HUD 装配
  store.ts           zustand：phase / panel / sel / mode / quality / session
  ui/
    primitives.tsx   ShapeIcon、Panel、Stat、Chip、日期与比例尺工具
    hud.tsx          顶部 HUD、右侧工具、比例尺（lucide-react 图标）
    panels.tsx       车站 / 城市（含区县·乡镇）/ 城市列表 / 科技 / 设置 / 帮助 / 线路面板
    screens.tsx      标题页与结算页
  game/
    engine.ts        纯逻辑：线路、列车、乘客路由、经济、事件、桥梁与造价、平衡参数 BAL
    stationGen.ts    程序化站点生成（区县 → 站点，镇街 → 命名，每局种子不同）
    geo.ts           经纬度投影 + 陆地掩膜（离屏 canvas，Node 下退回几何判定）+ 水系判定
    rivers.ts        河流带状几何、河段索引、水面流动
    path.ts          三次 Hermite 样条中心线（含跨水桥拱高程）
    ribbon.ts        沿路径生成带状几何（宽度在顶点着色器展开）
    world.ts         场景：海洋、拉伸地块、河流、桥梁、城市建筑、列车实例化
    stationView.ts   车站与换乘枢纽的三维模型
    models.ts        程序化贴图与列车几何
    view.ts          相机、拾取、拖拽交互、2D 覆盖层
  data/
    map.json         71 个地级行政区边界（polys，经简化）
    cities.ts        城市元数据（省、短名、配色、中心、面积）——数据脚本生成
    divisions.json   408 个区县 + 4055 个镇街名录——数据脚本生成
    rivers.ts        36 条干流水系走向
    gd.json          广东（含港澳）原始边界
```

## 数据来源

- 地级行政区 / 区县几何：`china-geojson`（省级）、`longwosion/geojson-map-china`（区县级 `geometryCouties`）
- 区县 / 镇街名录：`modood/Administrative-divisions-of-China`（`pcas-code.json`）
- 港澳 18 区 / 澳门 8 堂区：手工坐标

`map.json / cities.ts / divisions.json` 均由脚本离线生成后提交，运行时零网络请求。

## 调参

`src/game/engine.ts` 顶部的 `BAL` 集中全部平衡参数；起步城市为 `START_CITY = '440600'`（佛山），
城市解锁价按「距佛山的直线距离 + 区县数」计算。
