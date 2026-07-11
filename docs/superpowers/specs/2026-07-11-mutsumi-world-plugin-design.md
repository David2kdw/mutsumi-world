# 若叶睦「楚门的世界」插件设计规格 (v2)

**日期**: 2026-07-11
**状态**: 待审批
**修订**: 全面重构——物理与叙事分离、world.json 黑板模型、2D路网地图、星露谷式NPC

---

## 一、概述

为若叶睦（睦子米）QQ 机器人构建一个世界模拟插件。借鉴"楚门的世界"概念——睦子米身处一个持续运转的虚拟世界（月之森学园及周边），群友通过与她在 QQ 上聊天来感知她的世界。

**核心设计原则**: 代码管物理，DM 管叙事。插件是引擎，世界定义在数据文件中。加地点/事件/NPC 不需改代码。

---

## 二、架构

```
┌───────────────────────────────────────────────────────┐
│                  mutsumi-world 插件                    │
│                                                       │
│  ┌──────────────────┐  ┌────────────────────────┐    │
│  │  DM LLM (导演)    │  │  睦子米 LLM (角色)       │    │
│  │  模型: 小/快      │  │  模型: DeepSeek V4      │    │
│  │                  │  │                        │    │
│  │  职责:            │  │  职责:                  │    │
│  │  - 决定出发       │  │  - 通过工具读世界        │    │
│  │  - 渲染环境       │  │  - 自然回复群友          │    │
│  │  - 创作/收束事件  │  │  - 偶尔主动移动          │    │
│  │  - NPC 偶遇叙事   │  │                        │    │
│  └───────┬──────────┘  └──────────┬─────────────┘    │
│          │                        │                   │
│  代码管: │       world.json        │ 工具:              │
│  - 路线   │  ┌─────────────────┐   │ world_status       │
│  - 坐标   │  │ _dm (DM 读写)    │   │ observe_surroundings│
│  - 到达   │  │ 天气/日程/环境    │   │ check_schedule     │
│  - NPC    │  │ 活跃事件          │   │ move_to            │
│   位置    │  ├─────────────────┤   │                    │
│          │  │ _mutsumi (只读)   │   │                    │
│          │  │ 位置/轨迹         │   │                    │
│          │  └─────────────────┘   │                    │
│          │                        │                    │
│  数据文件 (JSON)                   │                    │
│  locations / road_network         │                    │
│  schedule / weather / events      │                    │
│  npcs / rules                     │                    │
└──────────────────────────────────────┘
```

**关键分工**：
- **代码**管所有物理计算：路线计算、坐标推进、到达检测、NPC 位置更新、触发类型判断
- **DM LLM** 管叙事：渲染环境、创作事件、收束事件、NPC 偶遇叙事
- **睦子米 LLM** 通过工具读世界，自然回复群友

---

## 三、world.json

插件整个运行时的世界状态，写入 `world.json`。分为两个区。

### 结构

```json
{
  "last_tick": "10:35",
  "date": "2026-07-11",
  "day_type": "weekday",

  "_dm": {
    "weather": "晴",
    "schedule": [
      { "start": "08:00", "end": "08:50", "location": "教室", "activity": "数学" },
      { "start": "08:50", "end": "09:40", "location": "教室", "activity": "国文" },
      { "start": "09:40", "end": "09:50", "location": "教室", "activity": "课间" },
      { "start": "09:50", "end": "10:40", "location": "教室", "activity": "英语" },
      { "start": "10:40", "end": "10:50", "location": "教室", "activity": "课间" },
      { "start": "10:50", "end": "11:40", "location": "教室", "activity": "体育" },
      { "start": "11:40", "end": "12:00", "location": "教室", "activity": "收拾" },
      { "start": "12:00", "end": "13:00", "location": "中庭", "activity": "午休" },
      { "start": "13:00", "end": "13:50", "location": "教室", "activity": "理科" },
      { "start": "13:50", "end": "14:40", "location": "教室", "activity": "社会" },
      { "start": "14:40", "end": "14:50", "location": "教室", "activity": "课间" },
      { "start": "14:50", "end": "15:30", "location": "教室", "activity": "家庭科" },
      { "start": "15:30", "end": "17:00", "location": "菜园", "activity": "自由" },
      { "start": "17:00", "end": "19:00", "location": "练习室", "activity": "排练" },
      { "start": "19:00", "end": "23:00", "location": "家", "activity": "自由" },
      { "start": "23:00", "end": "07:00", "location": "家", "activity": "睡眠" }
    ],
    "environment": "教室。上午的阳光从窗户照进来。老师在黑板上写公式。有人偷偷传纸条。",
    "active_events": [
      { "id": "aphids", "name": "黄瓜蚜虫", "location": "菜园", "status": "未处理" }
    ]
  },

  "_mutsumi": {
    "position": {
      "type": "location",
      "name": "教室"
    },
    "trajectory": [
      { "time": "07:55", "note": "出发去教室" },
      { "time": "08:00", "note": "到达教室" },
      { "time": "08:50", "note": "数学课结束" },
      { "time": "15:35", "note": "到达菜园，发现黄瓜叶上有蚜虫" }
    ]
  }
}
```

### 规则

| 字段 | 谁写 | 谁读 | 说明 |
|------|------|------|------|
| `last_tick` | 代码 | 代码 | 崩溃恢复用 |
| `date` | 代码 | 代码 + DM + 睦子米 | |
| `day_type` | 代码 | DM | weekday / saturday / sunday |
| `_dm.weather` | 代码（07:00随机） | DM + 睦子米 | DM 不能改写 |
| `_dm.schedule` | DM（07:00晨间展开） | 代码 + 睦子米 | 用于触发日程边界 |
| `_dm.environment` | DM（每次触发点） | 睦子米（via observe） | 被动observe时刷新 |
| `_dm.active_events` | DM（创作/收束） | 睦子米（via observe） | 一天不超过3个 |
| `_mutsumi.position` | 代码 + 睦子米（via move_to） | 代码 + DM | type: "location" 或 "traveling" |
| `_mutsumi.trajectory` | 代码（移动/日程边界）+ DM（事件） | DM + 睦子米 + 日记 | 纯事实，不含感受 |

- DM 可以读 `_mutsumi`（导演需要知道角色在哪、做了什么）
- 不存时间——睦子米和 DM 都能获取系统时间
- 轨迹只陈述事实：出发、到达、日程段开始/结束。不写感受、不写评价
- `position.type: "traveling"` 时包含 `from`、`to`、`route`（路网点列表）、`progress`（0-1）

---

## 四、地图与路网

### 4.1 地点

```json
{
  "若叶家":   { "coord": [0, 0],   "area": "住宅区" },
  "丰川家":   { "coord": [-80, 20], "area": "住宅区" },
  "长崎家":   { "coord": [60, -30], "area": "住宅区" },
  "校门":     { "coord": [120, 30], "area": "月之森学园" },
  "教室":     { "coord": [150, 80], "area": "月之森学园" },
  "中庭":     { "coord": [180, 60], "area": "月之森学园" },
  "菜园":     { "coord": [220, 50], "area": "月之森学园" },
  "音乐室":   { "coord": [130, 90], "area": "月之森学园" },
  "练习室":   { "coord": [-30, 40], "area": "住宅区" },
  "体育馆":   { "coord": [170, 120],"area": "月之森学园" }
}
```

- 坐标单位：真实米
- 移动速度：步行 1.2 m/s

### 4.2 通用路网

```json
{
  "nodes": [
    { "id": "n1",  "coord": [0, 0]    },
    { "id": "n2",  "coord": [-80, 20]  },
    { "id": "n3",  "coord": [60, -30]  },
    { "id": "n4",  "coord": [100, 20]  },
    { "id": "n5",  "coord": [120, 30]  },
    { "id": "n6",  "coord": [130, 55]  },
    { "id": "n7",  "coord": [150, 80]  },
    { "id": "n8",  "coord": [180, 60]  },
    { "id": "n9",  "coord": [220, 50]  },
    { "id": "n10", "coord": [130, 90]  },
    { "id": "n11", "coord": [170, 120] },
    { "id": "n12", "coord": [-30, 40]  }
  ],
  "edges": [
    { "from": "n1",  "to": "n4",  "distance": 100 },
    { "from": "n2",  "to": "n4",  "distance": 180 },
    { "from": "n3",  "to": "n4",  "distance": 60  },
    { "from": "n4",  "to": "n5",  "distance": 25  },
    { "from": "n5",  "to": "n6",  "distance": 28  },
    { "from": "n6",  "to": "n7",  "distance": 30  },
    { "from": "n6",  "to": "n8",  "distance": 50  },
    { "from": "n8",  "to": "n9",  "distance": 55  },
    { "from": "n7",  "to": "n10", "distance": 25  },
    { "from": "n8",  "to": "n11", "distance": 62  },
    { "from": "n5",  "to": "n12", "distance": 155 },
    { "from": "n1",  "to": "n12", "distance": 45  }
  ]
}
```

- 所有地点共享同一路网
- 每个地点关联到最近的路网节点
- 代码用 Dijkstra 算最短路径
- 加新地点只需加节点和边

---

## 五、日程系统

### 5.1 模板

```json
{
  "weekday": {
    "07:00": "家",
    "08:00": "教室",
    "12:00": "中庭",
    "13:00": "教室",
    "15:30": "菜园",
    "17:00": "练习室",
    "19:00": "家"
  },
  "saturday": {
    "08:00": "家",
    "10:00": "菜园",
    "13:00": "练习室",
    "18:00": "家"
  },
  "sunday": {
    "08:00": "家",
    "14:00": "练习室",
    "18:00": "家"
  },
  "class_timetable": {
    "monday":    ["数学", "国文", "英语", "体育", "理科", "社会"],
    "tuesday":   ["英语", "数学", "理科", "国文", "音乐", "美术"],
    "wednesday": ["国文", "社会", "数学", "英语", "体育", "理科"],
    "thursday":  ["理科", "英语", "国文", "社会", "数学", "家庭科"],
    "friday":    ["数学", "理科", "英语", "国文", "社会", "英语"]
  }
}
```

### 5.2 晨间展开

07:00 DM 晨间 tick：读模板 + class_timetable → 展开完整当天日程 → 写入 `_dm.schedule`。

展开规则：
- 每节课 50 分钟 + 课间 10 分钟
- 上午 4 节（08:00-12:00），下午 2-3 节，午休 1 小时
- DM 可以覆盖日程的任意时段（天气原因、心情原因），覆盖需要有理由
- 周六/日不展开课表，直接用模板

---

## 六、Tick 与触发点

### 6.1 触发点一览

| 触发点 | 触发方 | DM 做什么 |
|--------|--------|-----------|
| 07:00 晨间 | 定时 | 展开日程 + 渲染早晨环境 |
| 每 10 分钟（07:00-23:00） | 定时 | 常规 tick（环境更新 + 可能事件 + 判断出发） |
| 日程段开始 | 代码检测 | 渲染（如"上课铃响"） |
| 日程段结束 | 代码检测 | 渲染 + 可能事件（如"下课有人搭话"） |
| 出发 | DM 决定 + 代码执行 | 渲染离开场景 |
| 到达 | 代码检测坐标 | 渲染新地点环境 + 可能事件 |
| 睦子米 observe_surroundings | 工具触发 | 写 DM session，刷新 environment |
| 睦子米 move_to | 工具触发 | 写 DM session，渲染离开/新环境 |

### 6.2 每次 tick 代码做什么

1. 对比当前时间 vs `_dm.schedule` → 判断是否跨过日程边界
2. 如果睦子米 traveling → 推进坐标（elapsed × speed × progress）
3. 检查是否到达目的地
4. 计算所有 NPC 当前位置
5. 调用 DM 前，准备以下信息注入 prompt：
   - **当前段**：现在该在哪、做什么
   - **下一段**（如不在 traveling）：下个日程段的开始时间、地点、距离、预估步行时间
   - **位置摘要**：当前位置（静态/路上）、NPC 位置列表
6. 需要 DM 叙事决策时调用 DM，否则只更新 `last_tick`

### 6.3 出发决策

DM 不需要等到下一段开始时间才行动。每次 tick 时代码告诉 DM 下一段的距离和预估时间，DM 自行判断是否现在出发。

例如：07:30 tick → 下一段 08:00 教室，距离 200m，预估 3 分钟。DM 可能决定 07:45 出发（提前打余量），也可能等到 07:50。DM 写入 traveling 状态后，代码开始推进坐标。

### 6.4 路上状态

睦子米 traveling 时被调工具：

- `world_status` → 返回"正在从家去教室的路上"
- `observe_surroundings` → DM 根据当前所在路线节点渲染路景（如"住宅区的街道。早上阳光有点刺眼。远处能看到校门。"）
- `check_schedule` → 返回当前段（traveling）+ 后续日程

### 6.5 夜间（23:00-07:00）

- 不主动 tick
- DM session 保留存活
- 仅响应睦子米的 observe/move_to 请求（如凌晨群友 @ 她）

---

## 七、NPC 系统

### 7.1 数据结构

```json
{
  "丰川祥子": {
    "display": "祥子",
    "speed": 1.2,
    "schedule": {
      "weekday": [
        { "time": "07:30", "from": "丰川家", "to": "校门", "activity": "上学" },
        { "time": "08:00", "from": "校门", "to": "教室", "activity": "上课" },
        { "time": "12:00", "from": "教室", "to": "中庭", "activity": "午休" },
        { "time": "13:00", "from": "中庭", "to": "教室", "activity": "下午课" },
        { "time": "15:30", "from": "教室", "to": "练习室", "activity": "练琴" },
        { "time": "19:00", "from": "练习室", "to": "丰川家", "activity": "回家" }
      ]
    }
  },
  "长崎素世": {
    "display": "素世",
    "speed": 1.1,
    "schedule": {
      "weekday": [
        { "time": "07:45", "from": "长崎家", "to": "校门", "activity": "上学" },
        { "time": "08:00", "from": "校门", "to": "教室", "activity": "上课" },
        { "time": "12:00", "from": "教室", "to": "中庭", "activity": "午休" },
        { "time": "13:00", "from": "中庭", "to": "教室", "activity": "下午课" },
        { "time": "15:30", "from": "教室", "to": "中庭", "activity": "发呆" },
        { "time": "17:00", "from": "中庭", "to": "长崎家", "activity": "回家" }
      ]
    }
  }
}
```

### 7.2 运行方式

- 星露谷式——NPC 按 schedule 在路网上移动
- 代码在每次 tick 根据 schedule + 当前时间算 NPC 坐标
- DM tick 时拿到所有 NPC 的位置 → 判断是否与睦子米近距离 → 创作偶遇叙事
- 偶遇由 DM 自由裁决——不是代码硬触发

---

## 八、事件系统

### 8.1 生命周期

**生**：任何触发点 DM 都可自由创作事件。`events.json` 仅作灵感参考——DM 可以选择、改编或完全即兴。写入 `_dm.active_events`，同时追加一条轨迹（如"菜园发现蚜虫"）。

**存**：一天最多 2-3 个新事件。`active_events` 同时不超过 3 个。平淡的日常是常态。

**灭**：DM 在后续 tick 中自然收束。事件放了几天 → DM 决定翻篇 → 从 `active_events` 移除。不收束不算错误——事件可以默默淡出。

### 8.2 事件结构

```json
{ "id": "aphids", "name": "黄瓜蚜虫", "location": "菜园", "status": "未处理" }
```

### 8.3 DM prompt 关键指令

- 默认不产生事件。平淡的日子是好的。
- 只有当这个时刻确实值得记住时才创作。
- 旧事件要收束——放了三天的事该结束了。

---

## 九、DM Session 管理

### 9.1 生命周期

```
07:00 晨间:
  创建当日 DM session
  注入: rules.json + 当天日程 + 前两日日记 + 当前 world.json
  晨间 tick: 展开日程 → 渲染早晨

07:00-23:00:
  每次 tick: 读 world.json 快照 → DM 叙事 → 写 world.json
  睦子米 observe/move_to: 写 session → 写 world.json
  同一 session 持续到次日 07:00，累积上下文

次日 07:00:
  旧 session 关闭，新 session 创建
```

### 9.2 DM 权限

- 读：world.json 全部（含 `_mutsumi`）+ 所有数据文件
- 写：`_dm` 全部字段 + `_mutsumi.trajectory`（追加 note）

---

## 十、工具设计

### 10.1 四个工具

| 工具 | 操作 | 触发 DM | 说明 |
|------|------|---------|------|
| `world_status` | 读 `_mutsumi` + `_dm.weather` | 否 | 返回当前位置、天气、轨迹摘要 |
| `check_schedule` | 读 `_dm.schedule` | 否 | 返回当前及后续日程 |
| `observe_surroundings` | 读 `_dm.environment` + `active_events` | 是 | 每次调用进 DM session，刷新环境 |
| `move_to` | 写 `_mutsumi.position` | 是 | 代码算路线 → traveling → DM 渲染 |

- 工具返回代码格式化后的自然语言，睦子米看不到 JSON
- `observe_surroundings` 无过期概念，每次调用都触发 DM

### 10.2 `move_to` 流程

1. 睦子米调 `move_to("菜园")`
2. 代码在路网上算路径 → 写 traveling 状态到 `_mutsumi.position`
3. 同步调 DM：渲染"离开当前地点"
4. DM 返回叙事 + 更新 `_dm.environment`
5. 工具返回给睦子米
6. 后续 tick 代码推进坐标 → 到达后 DM 渲染新环境

---

## 十一、日记系统

### 11.1 触发

每日 23:30，插件定时器。

### 11.2 输入

- world.json 今日轨迹（`_mutsumi.trajectory`）
- 当天 QQ 对话记录：从 `trajectory.jsonl` 按 timestamp 过滤当天的 `role: "user"` 和 `role: "assistant"` 消息

### 11.3 生成

- 独立 LLM session
- system prompt：SOUL.md（若叶睦人格）
- 提示词：以若叶睦口吻写简短日记。睦子米的风格——话少、直白、1-5 句。写今天发生了什么、感受如何。不写 AI 话。

### 11.4 输出

- 写入 `workspace/memory/YYYY-MM-DD.md`
- **双写**：插件内部 state 目录也存一份
- 清空 `_mutsumi.trajectory`，保留 position

---

## 十二、崩溃恢复

### 12.1 保护机制

1. **原子写**：写 world.json 先写 `.world.json.tmp`，写完 rename 覆盖
2. **`last_tick`**：记录上次 tick 时间，重启时计算缺口
3. **traveling 状态**：`position.type: "traveling"` 包含 `from`、`to`、`route`、`progress`
4. **NPC 纯计算**：NPC 位置完全由 schedule + 当前时间确定，不需恢复

### 12.2 恢复流程

```
重启 → 读 world.json
     → 计算 last_tick 到现在的缺口
     → 代码推进所有坐标（睦子米 + NPC）到当前时间
     → 重建 DM session（注入 world.json + 日记 + 数据文件）
     → 恢复正常 tick
```

### 12.3 测试

- 模拟进程被杀 → 重启 → 验证 world.json 一致、tick 无跳过、traveling 正确推进
- 写对应的自动化测试

---

## 十三、与现有系统集成

### 13.1 不碰的部分

- SOUL.md：本次不做修改（后续再加 §十三 世界感知）
- `game/garden.md`：保留不动，与菜园位置联动是后续演进
- `game/inventory.md`：保留不动
- `memory/funny-log.md`：保留不动

### 13.2 数据文件路径

- **开发时**：插件 `data/` 目录（打包在插件里）
- **首次安装**：复制到 `~/.openclaw/workspace/game/`
- **用户可手动编辑** data 文件，重启后生效

### 13.3 运行时文件路径

- `world.json`：插件 state 目录，插件管理
- 日记 `YYYY-MM-DD.md`：`workspace/memory/` + 插件内部双写
- 对话记录：读 `~/.openclaw/agents/main/sessions/` 下当天的 trajectory.jsonl

---

## 十四、技术选型

- **语言**：TypeScript（与 OpenClaw QQBot 插件一致）
- **地图**：2D 坐标 + 通用路网，代码 Dijkstra 最短路径
- **定时**：利用 OpenClaw 插件定时机制

---

## 十五、项目文件结构

```
C:\Users\Administrator\mutsumi-world/    ← 开发仓库 (git)
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-07-11-mutsumi-world-plugin-design.md  ← 本文件
├── src/
│   ├── index.ts              ← 插件入口
│   ├── dm-session.ts         ← DM session 管理 + tick 调度
│   ├── tools.ts              ← 4 个工具的注册和实现
│   ├── world-state.ts        ← world.json 读写 + 原子写
│   ├── map-engine.ts         ← 路网、路径计算、坐标推进
│   ├── npc-engine.ts         ← NPC 位置计算
│   ├── diary.ts              ← 日记生成
│   └── data-loader.ts        ← JSON 数据文件加载 + 安装时复制
├── data/
│   ├── locations.json
│   ├── road_network.json
│   ├── schedule.json
│   ├── weather.json
│   ├── events.json
│   ├── npcs.json
│   └── rules.json
├── openclaw.plugin.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## 十六、实现阶段

### Phase 1: 世界引擎核心
- 插件 skeleton（注册、配置、加载）
- 数据文件加载器
- world.json 读写模块（含原子写）
- 地图引擎（路网 + 路径计算 + 坐标推进）
- 日程展开（晨间 class_timetable → 完整 schedule）

### Phase 2: 移动系统
- 位置模型（location / traveling）
- 出发/到达检测
- 轨迹自动追加（纯事实 note）
- NPC 位置计算

### Phase 3: Tick 调度
- 10 分钟定时 tick
- 日程边界检测（开始/结束触发）
- 出发/到达触发
- 夜间暂停
- 崩溃恢复

### Phase 4: DM 系统
- DM session 生命周期管理
- 晨间展开 + 日程覆盖
- 环境渲染
- 事件创作/收束
- 读取聊天轨迹（observe/move_to 进 session）

### Phase 5: 工具注册
- 4 个工具向 OpenClaw 注册
- world_status / check_schedule（纯读）
- observe_surroundings（触发 DM）
- move_to（代码算路 + DM 渲染）

### Phase 6: 日记系统
- 日记 LLM session
- 轨迹 JSONL 解析（当天对话过滤）
- memory/YYYY-MM-DD.md 写入
- 插件内部双写
- 轨迹清空

### Phase 7: 集成 + 测试
- 端到端测试（群友 @ → 工具调用 → 自然回复）
- DM session 跨日一致性
- 崩溃恢复测试
- NPC 位置正确性测试

---

## 十七、后续演进

- SOUL.md §十三 世界感知
- 菜园联动（菜园位置 → garden.md 数据作为环境一部分）
- NPC 主动行为
- 长期剧情线
- 周末/假日特殊日程
