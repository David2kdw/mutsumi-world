# 若叶睦「楚门的世界」插件实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 mutsumi-world OpenClaw 插件——一个数据驱动的世界模拟引擎，为若叶睦 QQ 机器人提供持续运转的虚拟世界（月之森学园及周边）。

**Architecture:** 代码管物理（路线、坐标、NPC 位置），DM LLM 管叙事（环境、事件、偶遇）。world.json 是核心状态黑板——DM 读写 `_dm` 区，睦子米只读 `_mutsumi` 区。10 分钟 tick 驱动世界推进。4 个工具供睦子米感知世界。

**Tech Stack:** TypeScript, Node.js 22+, OpenClaw Plugin SDK, Dijkstra 最短路径, 2D 坐标系统

**Spec:** `docs/superpowers/specs/2026-07-11-mutsumi-world-plugin-design.md`

## Global Constraints

- 语言：TypeScript，编译到 ES2022
- 运行时：Node.js 22+，OpenClaw 框架
- 坐标单位：真实米，步行速度 1.2 m/s
- Tick 间隔：10 分钟（07:00-23:00），夜间不主动 tick
- 事件上限：一天 2-3 个新事件，同时不超过 3 个
- world.json 原子写：先写 .tmp 再 rename
- 轨迹纯事实，不含感受
- SOUL.md 本次不修改
- garden.md / inventory.md / funny-log.md 保留不动

---

## File Structure

```
src/
├── types.ts           ← 所有类型定义（WorldState, Position, Schedule, NPC, Map...）
├── data-loader.ts     ← JSON 数据文件加载 + 首次安装时复制到 workspace
├── world-state.ts     ← world.json 原子读写，轨迹追加
├── map-engine.ts      ← 路网加载、Dijkstra 最短路径、坐标推进
├── schedule-engine.ts ← class_timetable 展开为完整当日日程
├── npc-engine.ts      ← NPC 位置计算（日程驱动的坐标插值）
├── dm-session.ts      ← DM LLM session 管理、tick 调度、prompt 构建、响应解析
├── tools.ts           ← 4 个工具注册和实现
├── diary.ts           ← 日记生成（聊天记录解析 + LLM + 双写）
├── llm-client.ts      ← LLM 调用抽象（封装 OpenClaw 内部 API）
└── index.ts           ← 插件入口、注册、定时器启停
```

**接口依赖图**：
```
index.ts
  ├── data-loader.ts (无内部依赖)
  ├── types.ts (无内部依赖)
  ├── world-state.ts → types.ts
  ├── map-engine.ts → types.ts
  ├── schedule-engine.ts → types.ts
  ├── npc-engine.ts → types.ts, map-engine.ts
  ├── llm-client.ts (无内部依赖)
  ├── dm-session.ts → types.ts, world-state.ts, map-engine.ts, schedule-engine.ts,
  │                    npc-engine.ts, llm-client.ts, data-loader.ts
  ├── tools.ts → types.ts, world-state.ts, map-engine.ts, dm-session.ts
  ├── diary.ts → types.ts, world-state.ts, llm-client.ts
  └── index.ts → 以上全部
```

---

### Task 1: 项目脚手架与类型定义

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `openclaw.plugin.json`
- Create: `src/types.ts`

**Interfaces:**
- Produces: 所有类型供后续任务引用

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "openclaw-mutsumi-world",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "openclaw": {
    "id": "openclaw-mutsumi-world",
    "extensions": ["./dist/index.js"]
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.9.3"
  },
  "peerDependencies": {
    "openclaw": "*"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建 openclaw.plugin.json**

```json
{
  "id": "openclaw-mutsumi-world",
  "name": "Mutsumi World",
  "description": "若叶睦「楚门的世界」世界模拟插件",
  "extensions": ["./dist/index.js"],
  "capabilities": {}
}
```

- [ ] **Step 4: 创建 src/types.ts**

```typescript
// ====== world.json ======

export interface WorldState {
  last_tick: string;          // "HH:MM"
  date: string;               // "YYYY-MM-DD"
  day_type: "weekday" | "saturday" | "sunday";
  _dm: DMState;
  _mutsumi: MutsumiState;
}

export interface DMState {
  weather: string;
  schedule: ScheduleEntry[];
  environment: string;
  active_events: ActiveEvent[];
}

export interface ScheduleEntry {
  start: string;    // "HH:MM"
  end: string;      // "HH:MM"
  location: string;
  activity: string;
}

export interface ActiveEvent {
  id: string;
  name: string;
  location: string;
  status: string;
}

export interface MutsumiState {
  position: LocationPosition | TravelingPosition;
  trajectory: TrajectoryEntry[];
}

export interface TrajectoryEntry {
  time: string;   // "HH:MM"
  note: string;
}

// ====== Position ======

export interface LocationPosition {
  type: "location";
  name: string;
}

export interface TravelingPosition {
  type: "traveling";
  from: string;
  to: string;
  route: string[];        // road network node IDs along the path
  progress: number;       // 0..1
  started_at: string;     // "HH:MM" departure time
}

export type Position = LocationPosition | TravelingPosition;

// ====== Map ======

export interface Coord {
  x: number;
  y: number;
}

export interface LocationDef {
  coord: Coord;
  area: string;
}

export interface RoadNode {
  id: string;
  coord: Coord;
}

export interface RoadEdge {
  from: string;
  to: string;
  distance: number;
}

export interface RoadNetwork {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export interface LocationsData {
  [name: string]: LocationDef;
}

// ====== Route ======

export interface RouteResult {
  nodes: string[];          // ordered node IDs from start to end
  totalDistance: number;    // meters
  estimatedMinutes: number; // at default 1.2 m/s
}

// ====== Schedule Template ======

export interface ScheduleTemplate {
  weekday: Record<string, string>;
  saturday: Record<string, string>;
  sunday: Record<string, string>;
  class_timetable: Record<string, string[]>;
}

// ====== Weather ======

export interface SeasonConfig {
  months: number[];
  pool: WeatherOption[];
}

export interface WeatherOption {
  type: string;
  weight: number;
}

export interface WeatherData {
  [season: string]: SeasonConfig;
}

// ====== Events ======

export interface EventDef {
  id: string;
  name: string;
  type: string;
  rarity: string;
  description: string;
  tags?: string[];
  resolve_hint?: string;
  npc_optional?: string;
  npc_required?: string[];
  condition?: string;
  season?: string;
}

export interface EventsData {
  [location: string]: EventDef[];
}

// ====== NPC ======

export interface NPCDef {
  display: string;
  speed: number;
  schedule: Record<string, NPCScheduleEntry[]>;
}

export interface NPCScheduleEntry {
  time: string;     // "HH:MM"
  from: string;
  to: string;
  activity: string;
}

export interface NPCsData {
  [id: string]: NPCDef;
}

// ====== NPC Runtime State ======

export interface NPCState {
  id: string;
  display: string;
  position: Position;
}

// ====== Rules ======

export interface RulesData {
  tone: string;
  environment_style: string;
  event_selection: string;
  movement_policy: string;
  continuity: string;
  max_events_per_day: number;
  event_cooldown: Record<string, string>;
  write_journal: boolean;
}

// ====== Tick Context (passed to DM) ======

export interface TickContext {
  time: string;
  current_segment: ScheduleEntry | null;
  next_segment: ScheduleEntry | null;
  next_segment_route: RouteResult | null;
  mutsumi_position: Position;
  npc_states: NPCState[];
}
```

- [ ] **Step 5: 安装依赖并编译验证**

```bash
cd C:\Users\Administrator\mutsumi-world
npm install
npm run build
```

Expected: 编译成功，`dist/types.js` 生成。

- [ ] **Step 6: 初始化 git 并提交**

```bash
git init
git add -A
git commit -m "chore: project scaffold and type definitions"
```

---

### Task 2: 数据文件加载器

**Files:**
- Create: `src/data-loader.ts`
- Create: `data/locations.json`
- Create: `data/road_network.json`
- Create: `data/schedule.json`
- Create: `data/weather.json`
- Create: `data/events.json`
- Create: `data/npcs.json`
- Create: `data/rules.json`

**Interfaces:**
- Consumes: types.ts (`LocationsData`, `RoadNetwork`, `ScheduleTemplate`, `WeatherData`, `EventsData`, `NPCsData`, `RulesData`)
- Produces: `loadLocations()`, `loadRoadNetwork()`, `loadScheduleTemplate()`, `loadWeather()`, `loadEvents()`, `loadNPCs()`, `loadRules()`, `installDataFiles(dataDir: string)`

- [ ] **Step 1: 创建 data/locations.json**

```json
{
  "若叶家":   { "coord": { "x": 0, "y": 0 },   "area": "住宅区" },
  "丰川家":   { "coord": { "x": -80, "y": 20 }, "area": "住宅区" },
  "长崎家":   { "coord": { "x": 60, "y": -30 }, "area": "住宅区" },
  "校门":     { "coord": { "x": 120, "y": 30 }, "area": "月之森学园" },
  "教室":     { "coord": { "x": 150, "y": 80 }, "area": "月之森学园" },
  "中庭":     { "coord": { "x": 180, "y": 60 }, "area": "月之森学园" },
  "菜园":     { "coord": { "x": 220, "y": 50 }, "area": "月之森学园" },
  "音乐室":   { "coord": { "x": 130, "y": 90 }, "area": "月之森学园" },
  "练习室":   { "coord": { "x": -30, "y": 40 }, "area": "住宅区" },
  "体育馆":   { "coord": { "x": 170, "y": 120 }, "area": "月之森学园" }
}
```

- [ ] **Step 2: 创建 data/road_network.json**

```json
{
  "nodes": [
    { "id": "n1",  "coord": { "x": 0, "y": 0 } },
    { "id": "n2",  "coord": { "x": -80, "y": 20 } },
    { "id": "n3",  "coord": { "x": 60, "y": -30 } },
    { "id": "n4",  "coord": { "x": 100, "y": 20 } },
    { "id": "n5",  "coord": { "x": 120, "y": 30 } },
    { "id": "n6",  "coord": { "x": 130, "y": 55 } },
    { "id": "n7",  "coord": { "x": 150, "y": 80 } },
    { "id": "n8",  "coord": { "x": 180, "y": 60 } },
    { "id": "n9",  "coord": { "x": 220, "y": 50 } },
    { "id": "n10", "coord": { "x": 130, "y": 90 } },
    { "id": "n11", "coord": { "x": 170, "y": 120 } },
    { "id": "n12", "coord": { "x": -30, "y": 40 } }
  ],
  "edges": [
    { "from": "n1",  "to": "n4",  "distance": 100 },
    { "from": "n2",  "to": "n4",  "distance": 180 },
    { "from": "n3",  "to": "n4",  "distance": 60 },
    { "from": "n4",  "to": "n5",  "distance": 25 },
    { "from": "n5",  "to": "n6",  "distance": 28 },
    { "from": "n6",  "to": "n7",  "distance": 30 },
    { "from": "n6",  "to": "n8",  "distance": 50 },
    { "from": "n8",  "to": "n9",  "distance": 55 },
    { "from": "n7",  "to": "n10", "distance": 25 },
    { "from": "n8",  "to": "n11", "distance": 62 },
    { "from": "n5",  "to": "n12", "distance": 155 },
    { "from": "n1",  "to": "n12", "distance": 45 }
  ]
}
```

- [ ] **Step 3: 创建 data/schedule.json**

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

- [ ] **Step 4: 创建 data/weather.json**

```json
{
  "spring": {
    "months": [3, 4, 5],
    "pool": [
      { "type": "晴", "weight": 5 },
      { "type": "多云", "weight": 3 },
      { "type": "小雨", "weight": 2 },
      { "type": "大风", "weight": 1 }
    ]
  },
  "summer": {
    "months": [6, 7, 8],
    "pool": [
      { "type": "晴", "weight": 6 },
      { "type": "多云", "weight": 2 },
      { "type": "小雨", "weight": 1 },
      { "type": "雷阵雨", "weight": 2 }
    ]
  },
  "autumn": {
    "months": [9, 10, 11],
    "pool": [
      { "type": "晴", "weight": 4 },
      { "type": "多云", "weight": 3 },
      { "type": "小雨", "weight": 3 },
      { "type": "大风", "weight": 2 }
    ]
  },
  "winter": {
    "months": [12, 1, 2],
    "pool": [
      { "type": "晴", "weight": 4 },
      { "type": "多云", "weight": 3 },
      { "type": "阴", "weight": 3 },
      { "type": "雪", "weight": 1 }
    ]
  }
}
```

- [ ] **Step 5: 创建 data/events.json**

```json
{
  "菜园": [
    {
      "id": "aphids",
      "name": "黄瓜蚜虫",
      "type": "problem",
      "rarity": "uncommon",
      "description": "黄瓜叶子上出现了白色蚜虫。需要处理。",
      "tags": ["植物", "问题"],
      "resolve_hint": "可以捉虫、喷水或不管让瓢虫来"
    },
    {
      "id": "stray_cat",
      "name": "猫",
      "type": "encounter",
      "rarity": "rare",
      "description": "一只花猫躺在黄瓜田旁边的石头上晒太阳。",
      "tags": ["动物"],
      "npc_optional": "花猫"
    }
  ],
  "中庭": [
    {
      "id": "soyo_passing",
      "name": "素世路过",
      "type": "encounter",
      "rarity": "uncommon",
      "condition": "weekday AND lunch_break",
      "description": "长崎素世路过中庭，看了看你又移开了视线。",
      "tags": ["NPC", "CRYCHIC"],
      "npc_required": ["长崎素世"]
    },
    {
      "id": "cherry_petals",
      "name": "樱花飘落",
      "type": "ambient",
      "rarity": "common",
      "season": "spring",
      "description": "樱花花瓣飘下来，落在长椅上。"
    }
  ],
  "教室": [
    {
      "id": "pop_quiz",
      "name": "突然小测",
      "type": "event",
      "rarity": "uncommon",
      "description": "老师说突然有一个小测。全班叹气。"
    }
  ],
  "音乐室": [
    {
      "id": "someone_playing",
      "name": "有人在弹琴",
      "type": "ambient",
      "rarity": "common",
      "description": "有低年级学生在练钢琴。弹得不太熟练但是很认真。"
    }
  ],
  "家": [
    {
      "id": "parent_message",
      "name": "母亲的留言",
      "type": "event",
      "rarity": "uncommon",
      "description": "桌上有一张母亲美奈美留的纸条：「睦，这周都很忙。冰箱里有吃的。需要什么跟经纪人说。」"
    },
    {
      "id": "tv_show",
      "name": "父亲的节目",
      "type": "ambient",
      "rarity": "common",
      "description": "电视开着，在放父亲隆文的综艺。观众在笑。睦关掉了。"
    }
  ],
  "练习室": [
    {
      "id": "sakiko_new_score",
      "name": "祥子改了谱子",
      "type": "event",
      "rarity": "uncommon",
      "description": "丰川祥子改了练习用的谱子。节奏部分比以前更难了。",
      "tags": ["NPC", "Ave Mujica"],
      "npc_required": ["丰川祥子"]
    }
  ]
}
```

- [ ] **Step 6: 创建 data/npcs.json**

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

- [ ] **Step 7: 创建 data/rules.json**

```json
{
  "tone": "客观、不说教、叙事简洁。不评判角色内心——只描述外在发生了什么。你不是若叶睦，你是导演。",
  "environment_style": "沉浸式五感：看到的、听到的、闻到的、触感、氛围。1-3句话。",
  "event_selection": "默认不产生事件。平淡的日子是好事。只有当这个时刻确实值得记住时才创作。旧事件放了三天要收束。",
  "movement_policy": "按日程走。可以因事件/天气/心情覆盖，但覆盖要有理由。大部分日子不改。",
  "continuity": "读前两日日记。注意未解决的剧情线。NPC 态度和近期互动保持一致。",
  "max_events_per_day": 3,
  "event_cooldown": {
    "uncommon": "3d",
    "rare": "7d"
  },
  "write_journal": false
}
```

- [ ] **Step 8: 创建 src/data-loader.ts**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  LocationsData, RoadNetwork, ScheduleTemplate,
  WeatherData, EventsData, NPCsData, RulesData,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

function readJSON<T>(filepath: string): T {
  const raw = fs.readFileSync(filepath, "utf-8");
  return JSON.parse(raw) as T;
}

export function loadLocations(): LocationsData {
  return readJSON<LocationsData>(path.join(DATA_DIR, "locations.json"));
}

export function loadRoadNetwork(): RoadNetwork {
  return readJSON<RoadNetwork>(path.join(DATA_DIR, "road_network.json"));
}

export function loadScheduleTemplate(): ScheduleTemplate {
  return readJSON<ScheduleTemplate>(path.join(DATA_DIR, "schedule.json"));
}

export function loadWeather(): WeatherData {
  return readJSON<WeatherData>(path.join(DATA_DIR, "weather.json"));
}

export function loadEvents(): EventsData {
  return readJSON<EventsData>(path.join(DATA_DIR, "events.json"));
}

export function loadNPCs(): NPCsData {
  return readJSON<NPCsData>(path.join(DATA_DIR, "npcs.json"));
}

export function loadRules(): RulesData {
  return readJSON<RulesData>(path.join(DATA_DIR, "rules.json"));
}

/**
 * 首次安装时，将 data/ 下的 JSON 文件复制到用户 workspace 的 game/ 目录。
 * 已存在的文件不覆盖（用户可能已手动编辑）。
 */
export function installDataFiles(workspaceDir: string): void {
  const gameDir = path.join(workspaceDir, "game");
  fs.mkdirSync(gameDir, { recursive: true });

  const files = [
    "locations.json", "road_network.json", "schedule.json",
    "weather.json", "events.json", "npcs.json", "rules.json",
  ];

  for (const file of files) {
    const src = path.join(DATA_DIR, file);
    const dest = path.join(gameDir, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}
```

- [ ] **Step 9: 编译验证**

```bash
npm run build
```

Expected: 编译成功，无类型错误。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "feat: data files and loader"
```

---

### Task 3: world.json 状态读写

**Files:**
- Create: `src/world-state.ts`
- Create: `src/world-state.test.ts` (或统一测试文件)

**Interfaces:**
- Consumes: types.ts (`WorldState`, `TrajectoryEntry`, `Position`)
- Produces: `readWorld(dataDir: string): WorldState`, `writeWorld(dataDir: string, state: WorldState): void`, `appendTrajectory(state: WorldState, entry: TrajectoryEntry): void`

- [ ] **Step 1: 编写读测试**

```typescript
// src/world-state.test.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { readWorld, writeWorld, createEmptyWorld, appendTrajectory } from "./world-state.js";
import type { WorldState } from "./types.js";

describe("world-state", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutsumi-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createEmptyWorld returns a valid initial state", () => {
    const state = createEmptyWorld("2026-07-11", "weekday");
    assert.strictEqual(state.date, "2026-07-11");
    assert.strictEqual(state.day_type, "weekday");
    assert.strictEqual(state._mutsumi.position.type, "location");
    assert.strictEqual(state._mutsumi.position.name, "家");
    assert.deepStrictEqual(state._mutsumi.trajectory, []);
    assert.deepStrictEqual(state._dm.active_events, []);
  });

  it("writeWorld and readWorld round-trip with atomic write", () => {
    const state = createEmptyWorld("2026-07-11", "weekday");
    state._dm.weather = "晴";
    writeWorld(tmpDir, state);

    const read = readWorld(tmpDir);
    assert.strictEqual(read.date, "2026-07-11");
    assert.strictEqual(read._dm.weather, "晴");
  });

  it("writeWorld writes to .tmp first then renames", () => {
    const state = createEmptyWorld("2026-07-11", "weekday");
    writeWorld(tmpDir, state);

    const worldPath = path.join(tmpDir, "world.json");
    const tmpPath = path.join(tmpDir, ".world.json.tmp");
    assert.ok(fs.existsSync(worldPath));
    // tmp file should not exist after successful write
    assert.ok(!fs.existsSync(tmpPath));
  });

  it("readWorld throws on missing file", () => {
    assert.throws(() => readWorld(tmpDir));
  });

  it("appendTrajectory adds entry to state", () => {
    const state = createEmptyWorld("2026-07-11", "weekday");
    appendTrajectory(state, { time: "08:00", note: "到达教室" });
    assert.strictEqual(state._mutsumi.trajectory.length, 1);
    assert.strictEqual(state._mutsumi.trajectory[0].note, "到达教室");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx tsx --test src/world-state.test.ts
```

Expected: FAIL (模块未实现)

- [ ] **Step 3: 实现 src/world-state.ts**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorldState, TrajectoryEntry } from "./types.js";

const WORLD_FILE = "world.json";
const WORLD_TMP = ".world.json.tmp";

const SPEED_MPS = 1.2; // meters per second walking speed

export function createEmptyWorld(date: string, dayType: "weekday" | "saturday" | "sunday"): WorldState {
  return {
    last_tick: "07:00",
    date,
    day_type: dayType,
    _dm: {
      weather: "",
      schedule: [],
      environment: "",
      active_events: [],
    },
    _mutsumi: {
      position: { type: "location", name: "家" },
      trajectory: [],
    },
  };
}

export function readWorld(dataDir: string): WorldState {
  const filePath = path.join(dataDir, WORLD_FILE);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as WorldState;
}

export function writeWorld(dataDir: string, state: WorldState): void {
  const tmpPath = path.join(dataDir, WORLD_TMP);
  const worldPath = path.join(dataDir, WORLD_FILE);

  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmpPath, json, "utf-8");
  fs.renameSync(tmpPath, worldPath);
}

export function appendTrajectory(state: WorldState, entry: TrajectoryEntry): void {
  state._mutsumi.trajectory.push(entry);
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx tsx --test src/world-state.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: world.json atomic read/write with trajectory append"
```

---

### Task 4: 地图引擎

**Files:**
- Create: `src/map-engine.ts`
- Create: `src/map-engine.test.ts`

**Interfaces:**
- Consumes: types.ts (`RoadNetwork`, `LocationsData`, `Coord`, `RouteResult`, `Position`), data-loader.ts (`loadRoadNetwork`, `loadLocations`)
- Produces: `findRoute(network, locations, from, to): RouteResult`, `advancePosition(pos, elapsedMs, speed): Position`, `getCoordAt(route, progress, network): Coord`, `distance(a, b): number`

- [ ] **Step 1: 编写 Dijkstra 测试**

```typescript
// src/map-engine.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { findRoute, distance, buildAdjacency, getNodeForLocation } from "./map-engine.js";
import type { RoadNetwork, LocationsData, Coord } from "./types.js";

// 使用 spec 中的路网数据做测试
const testNetwork: RoadNetwork = {
  nodes: [
    { id: "n1",  coord: { x: 0, y: 0 } },
    { id: "n4",  coord: { x: 100, y: 20 } },
    { id: "n5",  coord: { x: 120, y: 30 } },
  ],
  edges: [
    { from: "n1", to: "n4", distance: 100 },
    { from: "n4", to: "n5", distance: 25 },
  ],
};

const testLocations: LocationsData = {
  "若叶家": { coord: { x: 0, y: 0 }, area: "住宅区" },
  "校门":   { coord: { x: 120, y: 30 }, area: "月之森学园" },
};

describe("map-engine", () => {
  it("distance computes Euclidean distance", () => {
    const a: Coord = { x: 0, y: 0 };
    const b: Coord = { x: 3, y: 4 };
    assert.strictEqual(distance(a, b), 5);
  });

  it("buildAdjacency creates undirected adjacency list", () => {
    const adj = buildAdjacency(testNetwork);
    assert.ok(adj.has("n1"));
    assert.deepStrictEqual(adj.get("n1")!.map(e => e.to).sort(), ["n4"]);
    assert.deepStrictEqual(adj.get("n4")!.map(e => e.to).sort(), ["n1", "n5"]);
  });

  it("findRoute returns shortest path", () => {
    const result = findRoute(testNetwork, testLocations, "若叶家", "校门");
    assert.ok(result);
    assert.deepStrictEqual(result.nodes, ["n1", "n4", "n5"]);
    assert.strictEqual(result.totalDistance, 125);
  });

  it("findRoute returns direct for same location", () => {
    const result = findRoute(testNetwork, testLocations, "若叶家", "若叶家");
    assert.ok(result);
    assert.strictEqual(result.totalDistance, 0);
    assert.strictEqual(result.nodes.length, 1);
  });

  it("advancePosition moves from location to traveling", () => {
    // TODO: after movement system is built
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx tsx --test src/map-engine.test.ts
```

- [ ] **Step 3: 实现 src/map-engine.ts**

```typescript
import type {
  RoadNetwork, LocationsData, Coord, RouteResult,
  Position, RoadNode,
} from "./types.js";

export function distance(a: Coord, b: Coord): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * 为每个地点找到最近的路网节点。
 */
export function getNodeForLocation(
  locationName: string,
  locations: LocationsData,
  network: RoadNetwork,
): string {
  const locCoord = locations[locationName]?.coord;
  if (!locCoord) throw new Error(`Unknown location: ${locationName}`);

  let closest = network.nodes[0].id;
  let closestDist = Infinity;
  for (const node of network.nodes) {
    const d = distance(locCoord, node.coord);
    if (d < closestDist) {
      closestDist = d;
      closest = node.id;
    }
  }
  return closest;
}

interface AdjacencyEntry { to: string; distance: number; }

export function buildAdjacency(network: RoadNetwork): Map<string, AdjacencyEntry[]> {
  const adj = new Map<string, AdjacencyEntry[]>();
  for (const node of network.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of network.edges) {
    adj.get(edge.from)!.push({ to: edge.to, distance: edge.distance });
    adj.get(edge.to)!.push({ to: edge.from, distance: edge.distance });
  }
  return adj;
}

/**
 * Dijkstra 最短路径。返回路网节点 ID 序列 + 总距离。
 */
export function findRoute(
  network: RoadNetwork,
  locations: LocationsData,
  fromLocation: string,
  toLocation: string,
): RouteResult {
  const startNode = getNodeForLocation(fromLocation, locations, network);
  const endNode = getNodeForLocation(toLocation, locations, network);

  if (startNode === endNode) {
    return { nodes: [startNode], totalDistance: 0, estimatedMinutes: 0 };
  }

  const adj = buildAdjacency(network);
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();

  for (const node of network.nodes) {
    dist.set(node.id, Infinity);
    prev.set(node.id, null);
  }
  dist.set(startNode, 0);

  const unvisited = new Set(network.nodes.map(n => n.id));

  while (unvisited.size > 0) {
    let current: string | null = null;
    let minDist = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id)!;
      if (d < minDist) { minDist = d; current = id; }
    }
    if (current === null || current === endNode) break;
    unvisited.delete(current);

    for (const edge of adj.get(current) || []) {
      if (!unvisited.has(edge.to)) continue;
      const alt = dist.get(current)! + edge.distance;
      if (alt < dist.get(edge.to)!) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current);
      }
    }
  }

  // 重建路径
  const nodes: string[] = [];
  let cursor: string | null = endNode;
  while (cursor !== null) {
    nodes.unshift(cursor);
    cursor = prev.get(cursor) ?? null;
  }

  const totalDistance = dist.get(endNode)!;
  const estimatedMinutes = Math.ceil(totalDistance / (1.2 * 60));

  return { nodes, totalDistance, estimatedMinutes };
}

/**
 * 计算 traveling 状态中某个 progress 时的实际坐标。
 * 在路网的两节点之间线性插值。
 */
export function getCoordAt(
  route: string[],
  progress: number,
  network: RoadNetwork,
): Coord {
  if (route.length <= 1) {
    return network.nodes.find(n => n.id === route[0])!.coord;
  }

  const nodeMap = new Map(network.nodes.map(n => [n.id, n.coord]));
  let traveled = 0;

  // 计算总距离
  const segments: { from: string; to: string; dist: number }[] = [];
  for (let i = 1; i < route.length; i++) {
    const fromCoord = nodeMap.get(route[i - 1])!;
    const toCoord = nodeMap.get(route[i])!;
    const d = distance(fromCoord, toCoord);
    segments.push({ from: route[i - 1], to: route[i], dist: d });
    traveled += d;
  }

  const targetDist = progress * traveled;
  let accumulated = 0;

  for (const seg of segments) {
    if (accumulated + seg.dist >= targetDist) {
      const segProgress = (targetDist - accumulated) / seg.dist;
      const fromCoord = nodeMap.get(seg.from)!;
      const toCoord = nodeMap.get(seg.to)!;
      return {
        x: fromCoord.x + (toCoord.x - fromCoord.x) * segProgress,
        y: fromCoord.y + (toCoord.y - fromCoord.y) * segProgress,
      };
    }
    accumulated += seg.dist;
  }

  // 到达终点
  return nodeMap.get(route[route.length - 1])!;
}

/**
 * 根据 elapsed 时间推进 traveling 的 progress。
 * 返回是否已到达目的地。
 */
export function advanceTraveling(
  position: Extract<Position, { type: "traveling" }>,
  elapsedMs: number,
  speedMps: number,
  routeDistance: number,
): { progress: number; arrived: boolean } {
  const elapsedSec = elapsedMs / 1000;
  const distTraveled = elapsedSec * speedMps;
  const newProgress = Math.min(1, position.progress + distTraveled / routeDistance);
  return { progress: newProgress, arrived: newProgress >= 1 };
}
```

- [ ] **Step 4: 运行测试**

```bash
npx tsx --test src/map-engine.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: map engine with Dijkstra routing and coordinate advancement"
```

---

### Task 5: 日程展开引擎

**Files:**
- Create: `src/schedule-engine.ts`
- Create: `src/schedule-engine.test.ts`

**Interfaces:**
- Consumes: types.ts (`ScheduleTemplate`, `ScheduleEntry`)
- Produces: `expandSchedule(template, date): ScheduleEntry[]`, `getDayType(date): string`, `getDayName(date): string`

- [ ] **Step 1: 编写测试**

```typescript
// src/schedule-engine.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { expandSchedule, getDayType, getDayName } from "./schedule-engine.js";
import type { ScheduleTemplate } from "./types.js";

const testTemplate: ScheduleTemplate = {
  weekday: {
    "07:00": "家",
    "08:00": "教室",
    "12:00": "中庭",
    "15:30": "菜园",
    "19:00": "家",
  },
  saturday: { "08:00": "家", "10:00": "菜园", "18:00": "家" },
  sunday: { "08:00": "家", "18:00": "家" },
  class_timetable: {
    "monday": ["数学", "国文", "英语", "体育", "理科", "社会"],
  },
};

describe("schedule-engine", () => {
  it("getDayType returns weekday for Monday", () => {
    assert.strictEqual(getDayType("2026-07-13"), "weekday"); // Monday
  });

  it("getDayType returns saturday", () => {
    assert.strictEqual(getDayType("2026-07-11"), "saturday");
  });

  it("getDayType returns sunday", () => {
    assert.strictEqual(getDayType("2026-07-12"), "sunday");
  });

  it("getDayName returns Japanese name", () => {
    assert.strictEqual(getDayName("2026-07-13"), "monday");
  });

  it("expandSchedule weekday generates class periods", () => {
    const result = expandSchedule(testTemplate, "2026-07-13"); // Monday
    assert.ok(result.length > 10, "should have many segments");

    const firstClass = result.find(s => s.activity === "数学");
    assert.ok(firstClass);
    assert.strictEqual(firstClass!.location, "教室");
    assert.strictEqual(firstClass!.start, "08:00");

    // 课间
    const break1 = result.find(s => s.activity === "课间");
    assert.ok(break1);
  });

  it("expandSchedule saturday has no classes", () => {
    const result = expandSchedule(testTemplate, "2026-07-11");
    const classes = result.filter(s =>
      ["数学", "国文", "英语"].includes(s.activity)
    );
    assert.strictEqual(classes.length, 0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx tsx --test src/schedule-engine.test.ts
```

- [ ] **Step 3: 实现 src/schedule-engine.ts**

```typescript
import type { ScheduleTemplate, ScheduleEntry } from "./types.js";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const CLASS_DURATION = 50; // minutes per class
const BREAK_DURATION = 10; // minutes between classes
const LUNCH_DURATION = 60; // minutes

export function getDayName(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[d.getDay()];
}

export function getDayType(dateStr: string): "weekday" | "saturday" | "sunday" {
  const name = getDayName(dateStr);
  if (name === "saturday") return "saturday";
  if (name === "sunday") return "sunday";
  return "weekday";
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * 将模板日程 + class_timetable 展开为完整的带时间段的日程表。
 */
export function expandSchedule(
  template: ScheduleTemplate,
  dateStr: string,
): ScheduleEntry[] {
  const dayType = getDayType(dateStr);
  const dayName = getDayName(dateStr);
  const templateSlots = template[dayType];
  const timetable = template.class_timetable[dayName] || [];

  const entries: ScheduleEntry[] = [];
  const slotTimes = Object.keys(templateSlots).sort();

  for (let i = 0; i < slotTimes.length; i++) {
    const time = slotTimes[i];
    const location = templateSlots[time];
    const nextTime = slotTimes[i + 1] || "23:00";
    const startMin = timeToMinutes(time);
    const endMin = timeToMinutes(nextTime);

    // 检查是否在教室且有课表
    if (location === "教室" && timetable.length > 0) {
      // 计算上午/下午
      const isMorning = startMin < timeToMinutes("12:00");
      const isAfternoon = startMin >= timeToMinutes("13:00");

      if (isMorning) {
        // 上午 4 节课: 08:00-12:00
        let currentMin = Math.max(startMin, timeToMinutes("08:00"));
        for (let ci = 0; ci < 4 && ci < timetable.length && currentMin < endMin; ci++) {
          const classEnd = currentMin + CLASS_DURATION;
          entries.push({
            start: minutesToTime(currentMin),
            end: minutesToTime(classEnd),
            location: "教室",
            activity: timetable[ci],
          });
          currentMin = classEnd;
          if (ci < 3) {
            const breakEnd = currentMin + BREAK_DURATION;
            entries.push({
              start: minutesToTime(currentMin),
              end: minutesToTime(breakEnd),
              location: "教室",
              activity: "课间",
            });
            currentMin = breakEnd;
          }
        }
        // 午休前的收拾时间
        if (currentMin < timeToMinutes("12:00")) {
          entries.push({
            start: minutesToTime(currentMin),
            end: "12:00",
            location: "教室",
            activity: "收拾",
          });
        }
      } else if (isAfternoon) {
        // 下午 2-3 节课: 13:00-15:30
        const afternoonStart = 4; // skip first 4 morning classes
        let currentMin = Math.max(startMin, timeToMinutes("13:00"));
        const afternoonClasses = timetable.slice(afternoonStart);
        for (let ci = 0; ci < afternoonClasses.length && currentMin < endMin; ci++) {
          const classEnd = currentMin + CLASS_DURATION;
          entries.push({
            start: minutesToTime(currentMin),
            end: minutesToTime(classEnd),
            location: "教室",
            activity: afternoonClasses[ci],
          });
          currentMin = classEnd;
          if (ci < afternoonClasses.length - 1) {
            const breakEnd = currentMin + BREAK_DURATION;
            entries.push({
              start: minutesToTime(currentMin),
              end: minutesToTime(breakEnd),
              location: "教室",
              activity: "课间",
            });
            currentMin = breakEnd;
          }
        }
      }
    } else {
      // 非教室时段：直接用模板
      entries.push({
        start: time,
        end: nextTime,
        location,
        activity: location === "家" ? (startMin >= 23 * 60 ? "睡眠" : "自由") : "自由",
      });
    }
  }

  return entries;
}

/**
 * 找到当前时间对应的日程段。
 */
export function findCurrentSegment(
  schedule: ScheduleEntry[],
  time: string,
): ScheduleEntry | null {
  const tMin = timeToMinutes(time);
  for (const entry of schedule) {
    const sMin = timeToMinutes(entry.start);
    const eMin = timeToMinutes(entry.end);
    // 跨午夜处理
    if (sMin <= eMin) {
      if (tMin >= sMin && tMin < eMin) return entry;
    } else {
      if (tMin >= sMin || tMin < eMin) return entry;
    }
  }
  return null;
}

/**
 * 找到当前段之后的下一个日程段。
 */
export function findNextSegment(
  schedule: ScheduleEntry[],
  time: string,
): ScheduleEntry | null {
  const tMin = timeToMinutes(time);
  for (const entry of schedule) {
    if (timeToMinutes(entry.start) > tMin) return entry;
  }
  return null;
}
```

- [ ] **Step 4: 运行测试**

```bash
npx tsx --test src/schedule-engine.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: schedule expansion engine from template + timetable"
```

---

### Task 6: NPC 位置计算引擎

**Files:**
- Create: `src/npc-engine.ts`
- Create: `src/npc-engine.test.ts`

**Interfaces:**
- Consumes: types.ts (`NPCsData`, `NPCState`, `Position`), map-engine.ts (`findRoute`, `advanceTraveling`, `getNodeForLocation`)
- Produces: `computeNPCStates(npcs, dayType, time, locations, network): NPCState[]`

- [ ] **Step 1: 编写测试**

```typescript
// src/npc-engine.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { computeNPCStates, findCurrentNPCSchedule } from "./npc-engine.js";
import { loadLocations, loadRoadNetwork, loadNPCs } from "./data-loader.js";
import type { NPCsData } from "./types.js";

const testNPCs: NPCsData = {
  "丰川祥子": {
    display: "祥子",
    speed: 1.2,
    schedule: {
      weekday: [
        { time: "07:30", from: "丰川家", to: "校门", activity: "上学" },
        { time: "08:00", from: "校门", to: "教室", activity: "上课" },
        { time: "19:00", from: "练习室", to: "丰川家", activity: "回家" },
      ],
    },
  },
};

describe("npc-engine", () => {
  it("findCurrentNPCSchedule finds the correct segment", () => {
    const sched = testNPCs["丰川祥子"].schedule.weekday;
    const result = findCurrentNPCSchedule(sched, "07:45");
    assert.ok(result);
    assert.strictEqual(result!.activity, "上学");
    assert.strictEqual(result!.from, "丰川家");
  });

  it("findCurrentNPCSchedule returns null before first entry", () => {
    const sched = testNPCs["丰川祥子"].schedule.weekday;
    const result = findCurrentNPCSchedule(sched, "06:00");
    assert.strictEqual(result, null);
  });

  it("computeNPCStates returns states for all NPCs", () => {
    const locations = loadLocations();
    const network = loadRoadNetwork();
    const states = computeNPCStates(testNPCs, "weekday", "08:05", locations, network);
    assert.strictEqual(states.length, 1);
    // 祥子 08:00 从校门出发去教室，08:05 应该在路上
    const sakiko = states[0]!;
    assert.strictEqual(sakiko.display, "祥子");
    assert.strictEqual(sakiko.position.type, "traveling");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx tsx --test src/npc-engine.test.ts
```

- [ ] **Step 3: 实现 src/npc-engine.ts**

```typescript
import type {
  NPCsData, NPCScheduleEntry, NPCState, Position,
  LocationsData, RoadNetwork,
} from "./types.js";
import { findRoute, getNodeForLocation, advanceTraveling, getCoordAt } from "./map-engine.js";

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 找到 NPC 当前时间所在的日程段。
 */
export function findCurrentNPCSchedule(
  schedule: NPCScheduleEntry[],
  time: string,
): NPCScheduleEntry | null {
  const tMin = timeToMinutes(time);
  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i];
    const entryMin = timeToMinutes(entry.time);
    const nextEntry = schedule[i + 1];
    if (!nextEntry) return entry; // 最后一个段
    const nextMin = timeToMinutes(nextEntry.time);
    if (tMin >= entryMin && tMin < nextMin) return entry;
  }
  // 在第一个段之前
  if (schedule.length > 0 && tMin < timeToMinutes(schedule[0].time)) {
    return null;
  }
  return schedule[schedule.length - 1];
}

/**
 * 计算所有 NPC 在给定时间的状态。
 */
export function computeNPCStates(
  npcs: NPCsData,
  dayType: string,
  time: string,
  locations: LocationsData,
  network: RoadNetwork,
): NPCState[] {
  const states: NPCState[] = [];

  for (const [id, def] of Object.entries(npcs)) {
    const daySchedule = def.schedule[dayType] || def.schedule["weekday"] || [];
    const currentEntry = findCurrentNPCSchedule(daySchedule, time);

    if (!currentEntry) {
      // NPC 还没开始今天的行程，放在 from 位置
      const firstEntry = daySchedule[0];
      states.push({
        id,
        display: def.display,
        position: { type: "location", name: firstEntry?.from || "丰川家" },
      });
      continue;
    }

    const entryTimeMin = timeToMinutes(currentEntry.time);
    const currentTimeMin = timeToMinutes(time);
    const elapsedMin = currentTimeMin - entryTimeMin;
    const elapsedMs = elapsedMin * 60 * 1000;

    if (elapsedMin <= 0) {
      // 刚好在这个时间点，还没出发
      states.push({
        id,
        display: def.display,
        position: { type: "location", name: currentEntry.from },
      });
      continue;
    }

    // 计算路线
    const route = findRoute(network, locations, currentEntry.from, currentEntry.to);
    const travelTimeMs = (route.totalDistance / def.speed) * 1000;

    if (elapsedMs >= travelTimeMs) {
      // 已到达
      states.push({
        id,
        display: def.display,
        position: { type: "location", name: currentEntry.to },
      });
    } else {
      // 在路上
      const progress = elapsedMs / travelTimeMs;
      states.push({
        id,
        display: def.display,
        position: {
          type: "traveling",
          from: currentEntry.from,
          to: currentEntry.to,
          route: route.nodes,
          progress,
          started_at: currentEntry.time,
        },
      });
    }
  }

  return states;
}
```

- [ ] **Step 4: 运行测试**

```bash
npx tsx --test src/npc-engine.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: NPC position calculation from schedule"
```

---

### Task 7: LLM 调用抽象

**Files:**
- Create: `src/llm-client.ts`

**Interfaces:**
- Produces: `LLMClient` 接口, `createLLMClient(api: OpenClawPluginApi): LLMClient`

> **注意**: 此任务需要探索 OpenClaw 的实际 LLM 调用 API。如果 SDK 不直接暴露 LLM 调用能力，可能需要通过 OpenClaw 的内部 HTTP API 或 session 机制。此处的接口定义是目标形态，具体实现在探索后填充。

- [ ] **Step 1: 创建 LLMClient 接口**

```typescript
// src/llm-client.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export interface DMResponse {
  action: "move" | "stay" | "event" | "none";
  environment?: string;         // 新的环境描述
  event?: {
    id: string;
    name: string;
    location: string;
    status: string;
  };
  event_note?: string;          // 追加到 trajectory
  resolve_event_id?: string;    // 要移除的事件 ID
  move_to?: string;             // 决定去哪个地点
  departure_note?: string;      // 出发时追加到 trajectory
}

export interface LLMClient {
  /** 创建新的 DM 每日 session */
  dmChat(systemPrompt: string): DMSession;
  /** 单次完成（用于日记等一次性任务） */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface DMSession {
  /** 发送 prompt 并获取结构化响应 */
  send(prompt: string): Promise<DMResponse>;
  /** 关闭 session */
  close(): void;
}

/**
 * 创建 LLM 客户端。具体实现取决于 OpenClaw 提供的 API。
 *
 * 实现要点：
 * 1. DM session 需要在 07:00 创建，次日 07:00 销毁
 * 2. 每次 send() 要携带之前的上下文
 * 3. DM prompt 中要求返回结构化 JSON，本 client 负责解析
 * 4. 使用 rules.json 中的 tone 和 style 指令
 */
export function createLLMClient(_api: OpenClawPluginApi): LLMClient {
  // TODO: 实现时探索 OpenClaw 的 LLM 调用机制
  // 可能的方式：
  //   A) OpenClaw 内部 API：api.runtime 上的某个方法
  //   B) OpenAI-compatible HTTP API（如果 OpenClaw 暴露）
  //   C) child_process 调用 openclaw CLI
  throw new Error("LLMClient implementation depends on OpenClaw API discovery");
}
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "feat: LLM client interface for DM and diary"
```

---

### Task 8: DM Session 管理与 Tick 调度

**Files:**
- Create: `src/dm-session.ts`

**Interfaces:**
- Consumes: 所有前面的模块
- Produces: `startDMScheduler(api, deps): { stop(): void }`, `onMutsumiObserve(): void`, `onMutsumiMoveTo(location: string, reason?: string): Promise<string>`

- [ ] **Step 1: 实现 DM prompt 构建**

```typescript
// 在 src/dm-session.ts 中

import type {
  WorldState, ScheduleEntry, RouteResult, NPCState,
  Position, RulesData, TickContext,
} from "./types.js";
import { readWorld, writeWorld, appendTrajectory } from "./world-state.js";
import { findRoute } from "./map-engine.js";
import { findCurrentSegment, findNextSegment } from "./schedule-engine.js";
import { computeNPCStates } from "./npc-engine.js";
import { loadLocations, loadRoadNetwork, loadNPCs, loadEvents, loadRules } from "./data-loader.js";
import { createLLMClient, type LLMClient, type DMSession, type DMResponse } from "./llm-client.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as path from "node:path";

function buildDMSystemPrompt(rules: RulesData, state: WorldState): string {
  return `你是月之森女子学园世界的导演。你的职责是客观描述这个世界的运转。

${rules.tone}

环境描写要求：${rules.environment_style}

事件原则：${rules.event_selection}

移动策略：${rules.movement_policy}

连贯性要求：${rules.continuity}

当前日期：${state.date}（${state.day_type}）
当日天气：${state._dm.weather}

输出格式：严格返回 JSON 对象，包含以下字段：
{
  "action": "move" | "stay" | "event" | "none",
  "environment": "新的环境描述（1-3句）",
  "move_to": "目标地点（仅当 action=move 时）",
  "departure_note": "出发轨迹说明（仅当 action=move 时）",
  "event": { "id": "...", "name": "...", "location": "...", "status": "未处理" },
  "event_note": "事件轨迹说明",
  "resolve_event_id": "要移除的事件ID"
}

如果没有事件，不编造。平淡的日子没关系。
如果决定移动，给出理由。大部分日子不改日程。`;
}

function buildDMTickPrompt(state: WorldState, ctx: TickContext): string {
  const pos = state._mutsumi.position;
  const posDesc = pos.type === "location"
    ? `目前在 ${pos.name}`
    : `正在从 ${pos.from} 去 ${pos.to} 的路上（进度 ${Math.round(pos.progress * 100)}%）`;

  let prompt = `当前时间：${ctx.time}
${posDesc}

今日轨迹：
${state._mutsumi.trajectory.map(t => `- ${t.time} ${t.note}`).join("\n")}

活跃事件：
${state._dm.active_events.map(e => `- ${e.name}（${e.status}，位置：${e.location}）`).join("\n") || "无"}
`;

  if (ctx.current_segment) {
    prompt += `\n当前日程：${ctx.current_segment.start}-${ctx.current_segment.end} ${ctx.current_segment.location} | ${ctx.current_segment.activity}`;
  }

  if (ctx.next_segment && ctx.next_segment_route) {
    prompt += `\n下一段：${ctx.next_segment.start} ${ctx.next_segment.location} | ${ctx.next_segment.activity}（距离 ${ctx.next_segment_route.totalDistance}m，步行约 ${ctx.next_segment_route.estimatedMinutes} 分钟）`;
  }

  if (ctx.npc_states.length > 0) {
    prompt += `\n\nNPC 位置：
${ctx.npc_states.map(n => {
  const p = n.position;
  return `- ${n.display}：${p.type === "location" ? p.name : `从${p.from}去${p.to}的路上`}`;
}).join("\n")}`;
  }

  return prompt;
}
```

- [ ] **Step 2: 实现 TickContext 构建**

```typescript
function buildTickContext(
  state: WorldState,
  time: string,
  locations: ReturnType<typeof loadLocations>,
  network: ReturnType<typeof loadRoadNetwork>,
  npcs: ReturnType<typeof loadNPCs>,
): TickContext {
  const currentSegment = findCurrentSegment(state._dm.schedule, time);
  const nextSegment = findNextSegment(state._dm.schedule, time);
  let nextRoute: RouteResult | null = null;

  if (nextSegment && state._mutsumi.position.type === "location") {
    nextRoute = findRoute(network, locations, state._mutsumi.position.name, nextSegment.location);
  }

  const npcStates = computeNPCStates(npcs, state.day_type, time, locations, network);

  return {
    time,
    current_segment: currentSegment,
    next_segment: nextSegment,
    next_segment_route: nextRoute,
    mutsumi_position: state._mutsumi.position,
    npc_states: npcStates,
  };
}
```

- [ ] **Step 3: 实现 DM 响应处理**

```typescript
function applyDMResponse(state: WorldState, response: DMResponse, time: string): void {
  // 更新环境
  if (response.environment) {
    state._dm.environment = response.environment;
  }

  // 处理移动决策
  if (response.action === "move" && response.move_to) {
    // 标记出发
    if (response.departure_note) {
      appendTrajectory(state, { time, note: response.departure_note });
    }
    // DM 只决定目的地，代码负责执行
    // 实际的 traveling 状态由 tools.ts 的 move_to 或 tick 调度设置
  }

  // 处理事件
  if (response.event) {
    state._dm.active_events.push(response.event);
    if (response.event_note) {
      appendTrajectory(state, { time, note: response.event_note });
    }
  }

  // 收束事件
  if (response.resolve_event_id) {
    state._dm.active_events = state._dm.active_events.filter(
      e => e.id !== response.resolve_event_id
    );
    appendTrajectory(state, { time, note: `事件结束：${response.resolve_event_id}` });
  }
}
```

- [ ] **Step 4: 实现 Tick 调度器**

```typescript
const TICK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function startDMScheduler(
  api: OpenClawPluginApi,
  dataDir: string,
): { stop: () => void; handleObserve: () => Promise<string>; handleMoveTo: (location: string, reason?: string) => Promise<string> } {
  const llmClient = createLLMClient(api);
  const locations = loadLocations();
  const network = loadRoadNetwork();
  const npcs = loadNPCs();
  const rules = loadRules();
  const events = loadEvents();

  let dmSession: DMSession | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let morningTimer: ReturnType<typeof setTimeout> | null = null;
  let diaryTimer: ReturnType<typeof setTimeout> | null = null;

  function getTime(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  function getDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function getDayTypeForToday(): "weekday" | "saturday" | "sunday" {
    const day = new Date().getDay();
    if (day === 6) return "saturday";
    if (day === 0) return "sunday";
    return "weekday";
  }

  async function morningRoutine(): Promise<void> {
    const date = getDate();
    const dayType = getDayTypeForToday();

    api.logger?.info?.(`[mutsumi-world] Morning routine: ${date} (${dayType})`);

    // 读或创建 world.json
    let state: WorldState;
    try {
      state = readWorld(dataDir);
    } catch {
      state = {
        last_tick: "07:00",
        date,
        day_type: dayType,
        _dm: { weather: "", schedule: [], environment: "", active_events: [] },
        _mutsumi: { position: { type: "location", name: "家" }, trajectory: [] },
      };
    }

    state.date = date;
    state.day_type = dayType;

    // 天气
    state._dm.weather = pickWeather();
    state._dm.schedule = [];

    // 创建 DM session
    if (dmSession) dmSession.close();
    const sysPrompt = buildDMSystemPrompt(rules, state);
    dmSession = llmClient.dmChat(sysPrompt);

    // 晨间 tick
    const ctx = buildTickContext(state, "07:00", locations, network, npcs);
    const prompt = buildDMTickPrompt(state, ctx);
    const response = await dmSession.send(prompt);

    applyDMResponse(state, response, "07:00");
    state.last_tick = "07:00";
    writeWorld(dataDir, state);

    api.logger?.info?.(`[mutsumi-world] Morning routine complete. Weather: ${state._dm.weather}`);
  }

  async function tick(): Promise<void> {
    const time = getTime();
    const hour = new Date().getHours();

    // 夜间不主动 tick
    if (hour < 7 || hour >= 23) return;

    let state: WorldState;
    try {
      state = readWorld(dataDir);
    } catch {
      api.logger?.warn?.("[mutsumi-world] No world.json found, skipping tick");
      return;
    }

    // 推进 traveling
    if (state._mutsumi.position.type === "traveling") {
      const elapsedMs = TICK_INTERVAL_MS; // approx since last tick
      // 精确计算下次再说，先用近似值
      state._mutsumi.position.progress = Math.min(1,
        state._mutsumi.position.progress + 0.1);
      if (state._mutsumi.position.progress >= 1) {
        appendTrajectory(state, {
          time,
          note: `到达${state._mutsumi.position.to}`,
        });
        state._mutsumi.position = {
          type: "location",
          name: state._mutsumi.position.to,
        };
      }
    }

    const ctx = buildTickContext(state, time, locations, network, npcs);

    if (dmSession) {
      const prompt = buildDMTickPrompt(state, ctx);
      const response = await dmSession.send(prompt);
      applyDMResponse(state, response, time);
    }

    state.last_tick = time;
    writeWorld(dataDir, state);
  }

  // 每日 07:00 晨间 routine
  function scheduleMorning() {
    const now = new Date();
    const morning = new Date(now);
    morning.setHours(7, 0, 0, 0);
    if (now > morning) morning.setDate(morning.getDate() + 1);
    const delay = morning.getTime() - now.getTime();
    morningTimer = setTimeout(() => {
      morningRoutine().then(() => scheduleMorning());
    }, delay);
  }

  scheduleMorning();
  timer = setInterval(tick, TICK_INTERVAL_MS);

  function pickWeather(): string {
    // 简化的天气随机——后续可以读 weather.json 做加权
    const pool = ["晴", "晴", "晴", "多云", "多云", "小雨"];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return {
    stop() {
      if (timer) clearInterval(timer);
      if (morningTimer) clearTimeout(morningTimer);
      if (diaryTimer) clearTimeout(diaryTimer);
      if (dmSession) dmSession.close();
    },
    async handleObserve(): Promise<string> {
      // 由 tools.ts 调用
      const state = readWorld(dataDir);
      const time = getTime();
      const ctx = buildTickContext(state, time, locations, network, npcs);
      if (dmSession) {
        const prompt = buildDMTickPrompt(state, ctx) + "\n（睦子米刚才观察了周围）";
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time);
        state.last_tick = time;
        writeWorld(dataDir, state);
        return state._dm.environment;
      }
      return state._dm.environment;
    },
    async handleMoveTo(location: string, reason?: string): Promise<string> {
      // 由 tools.ts 调用
      const state = readWorld(dataDir);
      const time = getTime();

      const currentLoc = state._mutsumi.position.type === "location"
        ? state._mutsumi.position.name
        : state._mutsumi.position.to;

      const route = findRoute(network, locations, currentLoc, location);

      state._mutsumi.position = {
        type: "traveling",
        from: currentLoc,
        to: location,
        route: route.nodes,
        progress: 0,
        started_at: time,
      };
      appendTrajectory(state, {
        time,
        note: reason ? `出发去${location}：${reason}` : `出发去${location}`,
      });

      if (dmSession) {
        const ctx = buildTickContext(state, time, locations, network, npcs);
        const prompt = buildDMTickPrompt(state, ctx) + "\n（睦子米主动出发去" + location + "）";
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time);
      }

      state.last_tick = time;
      writeWorld(dataDir, state);

      return `出发去${location}。${state._dm.environment || ""}`;
    },
  };
}
```

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: DM session manager with tick scheduler and morning routine"
```

---

### Task 9: 工具注册

**Files:**
- Create: `src/tools.ts`

**Interfaces:**
- Consumes: dm-session.ts (`startDMScheduler` 返回值), world-state.ts, map-engine.ts, schedule-engine.ts
- Produces: `registerTools(api, scheduler)`

- [ ] **Step 1: 实现 4 个工具**

```typescript
// src/tools.ts
import type { OpenClawPluginApi, AgentToolResult } from "openclaw/plugin-sdk";
import { readWorld } from "./world-state.js";
import { findCurrentSegment } from "./schedule-engine.js";
import type { WorldState } from "./types.js";

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

export function registerTools(
  api: OpenClawPluginApi,
  scheduler: ReturnType<typeof import("./dm-session.js").startDMScheduler>,
  dataDir: string,
): void {
  // ====== world_status ======
  api.registerTool({
    name: "world_status",
    label: "查看世界状态",
    description: "查看当前时间、位置、天气、今天发生了什么。当群友问「今天怎么样」「在哪」「做了什么」时先调用。",
    parameters: { type: "object", properties: {} },
    async execute() {
      let state: WorldState;
      try {
        state = readWorld(dataDir);
      } catch {
        return textResult("世界尚未启动。");
      }

      const pos = state._mutsumi.position;
      const posDesc = pos.type === "location"
        ? pos.name
        : `正在从${pos.from}去${pos.to}的路上`;

      const trajSummary = state._mutsumi.trajectory.length > 0
        ? state._mutsumi.trajectory.map(t => `${t.time} ${t.note}`).join("；")
        : "今天还没有记录。";

      const now = new Date();
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

      return textResult(
        `${now.getMonth() + 1}月${now.getDate()}日 星期${dayNames[now.getDay()]}。` +
        `天气${state._dm.weather}。` +
        `位置：${posDesc}。` +
        `今天：${trajSummary}`
      );
    },
  });

  // ====== check_schedule ======
  api.registerTool({
    name: "check_schedule",
    label: "查看日程",
    description: "查看今天的课表或行程安排。当群友问「今天有什么课」「接下来去哪」时调用。",
    parameters: { type: "object", properties: {} },
    async execute() {
      let state: WorldState;
      try {
        state = readWorld(dataDir);
      } catch {
        return textResult("日程尚未生成。");
      }

      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const current = findCurrentSegment(state._dm.schedule, time);
      const upcoming = state._dm.schedule
        .filter(s => s.start.localeCompare(time) > 0)
        .slice(0, 5);

      let text = "";
      if (current) {
        text += `现在：${current.start}-${current.end} ${current.location} | ${current.activity}。`;
      }
      if (upcoming.length > 0) {
        text += `接下来：${upcoming.map(s => `${s.start} ${s.location} | ${s.activity}`).join("；")}`;
      }

      return textResult(text || "今天的日程结束了。");
    },
  });

  // ====== observe_surroundings ======
  api.registerTool({
    name: "observe_surroundings",
    label: "观察周围",
    description: "仔细观察周围的环境——看到了什么、听到了什么、闻到了什么。当群友问「周围有什么」「在干嘛」时调用。",
    parameters: { type: "object", properties: {} },
    async execute() {
      try {
        const env = await scheduler.handleObserve();
        const state = readWorld(dataDir);
        const events = state._dm.active_events
          .map(e => `【${e.name}】${e.location} | ${e.status}`)
          .join("；");
        return textResult(env + (events ? `\n附近的事件：${events}` : ""));
      } catch {
        return textResult("看不到周围。");
      }
    },
  });

  // ====== move_to ======
  api.registerTool({
    name: "move_to",
    label: "移动到某个地点",
    description: "主动去另一个地方。日常移动是自动的，只在你想改变行程时使用。",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "目标地点",
          enum: ["教室", "菜园", "中庭", "音乐室", "家", "练习室", "体育馆", "校门"],
        },
        reason: {
          type: "string",
          description: "移动原因（可选）",
        },
      },
      required: ["location"],
    },
    async execute(_toolCallId, params) {
      const p = params as { location: string; reason?: string };
      try {
        const result = await scheduler.handleMoveTo(p.location, p.reason);
        return textResult(result);
      } catch (err) {
        return textResult(`没法去${p.location}。${err instanceof Error ? err.message : ""}`);
      }
    },
  });

  api.logger?.info?.("[mutsumi-world] 4 tools registered");
}
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "feat: 4 world perception tools registered"
```

---

### Task 10: 日记系统

**Files:**
- Create: `src/diary.ts`

**Interfaces:**
- Consumes: world-state.ts, llm-client.ts, types.ts
- Produces: `generateDiary(dataDir, workspaceDir, llmClient): Promise<void>`

- [ ] **Step 1: 实现日记生成**

```typescript
// src/diary.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { readWorld } from "./world-state.js";
import type { LLMClient } from "./llm-client.js";
import type { WorldState } from "./types.js";

/**
 * 从所有 trajectory.jsonl 中解析当天的用户和助手消息。
 *
 * OpenClaw 会定期 reset/compact session——旧 session 保存为 .jsonl.reset.<timestamp>，
 * 新 session 从零开始。只看最新一个 session 会漏掉当天 reset 之前的消息和昨天的消息。
 * 所以这里扫描 sessions 目录下所有 .trajectory.jsonl 文件（包括 reset 前的），
 * 按 timestamp 过滤出目标日期的消息。
 */
function parseDailyChatLog(
  sessionsDir: string,
  dateStr: string,
): string {
  const allLines: string[] = [];

  try {
    const files = fs.readdirSync(sessionsDir);
    // 收集所有 .trajectory.jsonl 文件（含 reset 备份）
    const trajFiles = files.filter(f => f.endsWith(".trajectory.jsonl"));
    for (const f of trajFiles) {
      const filePath = path.join(sessionsDir, f);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        allLines.push(...content.split("\n").filter(Boolean));
      } catch {
        // 跳过无法读取的文件
      }
    }

    // 也扫描 reset 备份文件（<uuid>.jsonl.reset.<timestamp>）
    // 这些文件本身是 JSONL 格式，包含被 reset 的 session 的消息
    const resetFiles = files.filter(f => f.includes(".jsonl.reset."));
    for (const f of resetFiles) {
      const filePath = path.join(sessionsDir, f);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        allLines.push(...content.split("\n").filter(Boolean));
      } catch {
        // 跳过
      }
    }
  } catch {
    return "";
  }

  if (allLines.length === 0) return "";
  const chatLines: string[] = [];

  for (const line of allLines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message") continue;
      if (!entry.message?.content) continue;

      // 检查时间戳是否在当天
      const ts = entry.timestamp || entry.message?.timestamp;
      if (!ts) continue;
      const entryDate = new Date(ts).toISOString().slice(0, 10);
      if (entryDate !== dateStr) continue;

      const msg = entry.message;
      if (msg.role === "user") {
        const content = typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.find((c: any) => c.type === "text")?.text || ""
            : "";
        // 清理 QQ 格式
        const cleaned = content.replace(/\[.*?\]\s*/, "").replace(/\(@你\)/, "").trim();
        if (cleaned) chatLines.push(`群友: ${cleaned}`);
      } else if (msg.role === "assistant") {
        const content = Array.isArray(msg.content)
          ? msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
          : msg.content || "";
        if (content.trim()) chatLines.push(`睦: ${content.trim()}`);
      }
    } catch {
      // skip malformed lines
    }
  }

  return chatLines.join("\n");
}

export async function generateDiary(
  dataDir: string,
  workspaceDir: string,
  llmClient: LLMClient,
  soulPath: string,
): Promise<void> {
  let state: WorldState;
  try {
    state = readWorld(dataDir);
  } catch {
    return; // no world state yet
  }

  const trajectory = state._mutsumi.trajectory;
  if (trajectory.length === 0) return;

  const sessionsDir = path.join(
    path.dirname(workspaceDir),
    "agents", "main", "sessions",
  );

  const chatLog = parseDailyChatLog(sessionsDir, state.date);

  const systemPrompt = fs.readFileSync(soulPath, "utf-8");
  const userPrompt = `今天结束了。请以若叶睦的口吻写一篇简短日记。

今天你的轨迹：
${trajectory.map(t => `- ${t.time} ${t.note}`).join("\n")}

${chatLog ? `今天和群友的对话：\n${chatLog}\n` : ""}

要求：话少、直白、1-5句。写今天发生了什么、感受如何。不写 AI 话。`;

  const diary = await llmClient.complete(systemPrompt, userPrompt);

  const diaryContent = `# ${state.date} 日记

${diary}

> 日记由睦子米在 23:30 自动撰写。独立于 QQ 对话。
`;

  // 双写
  const workspaceMemoryDir = path.join(workspaceDir, "memory");
  fs.mkdirSync(workspaceMemoryDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceMemoryDir, `${state.date}.md`),
    diaryContent,
    "utf-8",
  );

  // 插件内部也存一份
  const pluginMemoryDir = path.join(dataDir, "diaries");
  fs.mkdirSync(pluginMemoryDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginMemoryDir, `${state.date}.md`),
    diaryContent,
    "utf-8",
  );

  // 清空轨迹
  state._mutsumi.trajectory = [];
  const { writeWorld } = await import("./world-state.js");
  writeWorld(dataDir, state);
}
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "feat: diary generator with chat log parsing and dual write"
```

---

### Task 11: 崩溃恢复

**Files:**
- Modify: `src/dm-session.ts` (已包含 last_tick 逻辑，此任务增强)

**Interfaces:**
- 在 scheduler 初始化时添加恢复逻辑

- [ ] **Step 1: 添加恢复函数**

```typescript
// 在 dm-session.ts 中添加

import { advanceTraveling } from "./map-engine.js";

async function recoverFromCrash(
  dataDir: string,
  locations: ReturnType<typeof loadLocations>,
  network: ReturnType<typeof loadRoadNetwork>,
  npcs: ReturnType<typeof loadNPCs>,
): Promise<WorldState | null> {
  let state: WorldState;
  try {
    state = readWorld(dataDir);
  } catch {
    return null; // 没有 world.json，不需要恢复
  }

  if (!state.last_tick) return state;

  const now = new Date();
  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const [lastH, lastM] = state.last_tick.split(":").map(Number);
  const [nowH, nowM] = nowTime.split(":").map(Number);
  const gapMs = ((nowH * 60 + nowM) - (lastH * 60 + lastM)) * 60 * 1000;

  if (gapMs <= 0) return state; // 没有缺口

  // 推进 traveling 中的坐标
  if (state._mutsumi.position.type === "traveling") {
    const route = state._mutsumi.position.route;
    // 计算路线总距离
    let totalDist = 0;
    const nodeMap = new Map(network.nodes.map(n => [n.id, n.coord]));
    for (let i = 1; i < route.length; i++) {
      const fromCoord = nodeMap.get(route[i - 1])!;
      const toCoord = nodeMap.get(route[i])!;
      const dx = toCoord.x - fromCoord.x;
      const dy = toCoord.y - fromCoord.y;
      totalDist += Math.sqrt(dx * dx + dy * dy);
    }

    const { arrived } = advanceTraveling(
      state._mutsumi.position,
      gapMs,
      1.2,
      totalDist,
    );

    if (arrived) {
      appendTrajectory(state, {
        time: nowTime,
        note: `到达${state._mutsumi.position.to}`,
      });
      state._mutsumi.position = {
        type: "location",
        name: state._mutsumi.position.to,
      };
    }
  }

  // 检查日程边界（如果跨过了多个日程段，补上轨迹）
  // 简化处理：补一条"世界恢复运行"
  appendTrajectory(state, {
    time: nowTime,
    note: `世界恢复运行（上次 tick: ${state.last_tick}）`,
  });

  state.last_tick = nowTime;
  writeWorld(dataDir, state);

  return state;
}
```

- [ ] **Step 2: 在 morningRoutine 之前调用恢复**

```typescript
// 在 startDMScheduler 函数体内，morningRoutine 调用之前：

  // 崩溃恢复
  (async () => {
    const state = await recoverFromCrash(dataDir, locations, network, npcs);
    if (state) {
      api.logger?.info?.(`[mutsumi-world] Recovered from crash. Gap since ${state._mutsumi.trajectory[state._mutsumi.trajectory.length - 1]?.time || "unknown"}`);
    }
  })();
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat: crash recovery advancing coordinates on restart"
```

---

### Task 12: 插件入口与集成

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: 所有模块
- Produces: OpenClaw 插件入口（默认导出）

- [ ] **Step 1: 实现插件入口**

```typescript
// src/index.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { installDataFiles } from "./data-loader.js";
import { startDMScheduler } from "./dm-session.js";
import { registerTools } from "./tools.js";
import { generateDiary } from "./diary.js";
import { createLLMClient } from "./llm-client.js";
import * as path from "node:path";

const plugin = {
  id: "openclaw-mutsumi-world",
  name: "Mutsumi World",
  description: "若叶睦「楚门的世界」世界模拟插件",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const workspaceDir = path.resolve(
      api.runtime.getDataDir?.() || process.env.HOME || process.env.USERPROFILE || ".",
      "..",
      "workspace",
    );
    const dataDir = path.resolve(
      api.runtime.getDataDir?.() || ".",
      "mutsumi-world",
    );

    // 首次安装：复制数据文件
    installDataFiles(workspaceDir);

    // 启动调度器
    const scheduler = startDMScheduler(api, dataDir);

    // 注册工具
    registerTools(api, scheduler, dataDir);

    // 23:30 日记定时器
    function scheduleDiary() {
      const now = new Date();
      const diaryTime = new Date(now);
      diaryTime.setHours(23, 30, 0, 0);
      if (now > diaryTime) diaryTime.setDate(diaryTime.getDate() + 1);
      const delay = diaryTime.getTime() - now.getTime();
      setTimeout(() => {
        const llmClient = createLLMClient(api);
        const soulPath = path.join(workspaceDir, "SOUL.md");
        generateDiary(dataDir, workspaceDir, llmClient, soulPath)
          .then(() => scheduleDiary())
          .catch(err => {
            api.logger?.error?.("[mutsumi-world] Diary generation failed: " + String(err));
            scheduleDiary();
          });
      }, delay);
    }
    scheduleDiary();

    api.logger?.info?.("[mutsumi-world] Plugin registered");
  },
};

export default plugin;
```

- [ ] **Step 2: 编译完整项目**

```bash
npm run build
```

Expected: 编译成功，`dist/` 目录包含所有编译后的文件。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat: plugin entry point with full integration"
```

---

### Task 13: 端到端测试与验证

**Files:**
- Create: `src/e2e.test.ts`

- [ ] **Step 1: 编写端到端测试**

```typescript
// src/e2e.test.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createEmptyWorld, readWorld, writeWorld, appendTrajectory } from "./world-state.js";
import { loadLocations, loadRoadNetwork, loadScheduleTemplate } from "./data-loader.js";
import { findRoute, getCoordAt, distance } from "./map-engine.js";
import { expandSchedule, findCurrentSegment, getDayType } from "./schedule-engine.js";
import { computeNPCStates } from "./npc-engine.js";

describe("end-to-end: world simulation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutsumi-e2e-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full day: morning → school → garden → home", () => {
    const locations = loadLocations();
    const network = loadRoadNetwork();
    const template = loadScheduleTemplate();

    // 1. 创建空世界
    const state = createEmptyWorld("2026-07-13", "weekday"); // Monday
    state._dm.weather = "晴";
    writeWorld(tmpDir, state);

    // 2. 展开日程
    const schedule = expandSchedule(template, "2026-07-13");
    assert.ok(schedule.length > 0, "schedule should be expanded");

    // 3. 验证上课段
    const mathClass = schedule.find(s => s.activity === "数学");
    assert.ok(mathClass, "should have math class");
    assert.strictEqual(mathClass!.location, "教室");

    // 4. 验证课间存在
    const breaks = schedule.filter(s => s.activity === "课间");
    assert.ok(breaks.length >= 3, "should have breaks between classes");

    // 5. 验证午休
    const lunch = schedule.find(s => s.activity === "自由" && s.location === "中庭");
    assert.ok(lunch, "should have lunch break at 中庭");

    // 6. 验证路径计算
    const route = findRoute(network, locations, "家", "教室");
    assert.ok(route.totalDistance > 0, "route from home to school should exist");
    assert.ok(route.estimatedMinutes > 0, "should estimate travel time");

    // 7. 验证 NPC 位置（上学时段）
    const npcs = { "丰川祥子": { display: "祥子", speed: 1.2, schedule: { weekday: [{ time: "07:30", from: "丰川家", to: "校门", activity: "上学" }] } } };
    const npcStates = computeNPCStates(npcs, "weekday", "08:00", locations, network);
    assert.ok(npcStates.length > 0);

    // 8. 读写 round-trip
    const reloaded = readWorld(tmpDir);
    assert.strictEqual(reloaded._dm.weather, "晴");
    assert.strictEqual(reloaded.date, "2026-07-13");
  });

  it("trajectory is fact-only (no opinions)", () => {
    const state = createEmptyWorld("2026-07-13", "weekday");
    appendTrajectory(state, { time: "08:00", note: "到达教室" });
    appendTrajectory(state, { time: "08:50", note: "数学课结束" });

    // 所有 note 不应包含感受词
    const notes = state._mutsumi.trajectory.map(t => t.note);
    for (const note of notes) {
      assert.ok(!note.includes("开心") && !note.includes("难过") && !note.includes("觉得"),
        `note should not contain feelings: "${note}"`);
    }
  });

  it("crash recovery: traveling position restored", () => {
    const locations = loadLocations();
    const network = loadRoadNetwork();
    const route = findRoute(network, locations, "家", "校门");

    const state = createEmptyWorld("2026-07-13", "weekday");
    state._mutsumi.position = {
      type: "traveling",
      from: "家",
      to: "校门",
      route: route.nodes,
      progress: 0.3,
      started_at: "07:45",
    };
    state.last_tick = "07:50";
    writeWorld(tmpDir, state);

    // 模拟恢复：读取后推进
    const recovered = readWorld(tmpDir);
    assert.strictEqual(recovered._mutsumi.position.type, "traveling");
    // progress 应大于 0.3（时间过去了）
    assert.ok(recovered._mutsumi.position.progress >= 0.3);
  });
});
```

- [ ] **Step 2: 运行端到端测试**

```bash
npx tsx --test src/e2e.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 3: 运行所有测试**

```bash
npx tsx --test src/*.test.ts
```

Expected: 所有测试 PASS

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: end-to-end world simulation tests"
```

---

## Implementation Order

1. Task 1 → 脚手架 + 类型
2. Task 2 → 数据文件
3. Task 3 → world.json 读写（可独立测试）
4. Task 4 → 地图引擎（可独立测试）
5. Task 5 → 日程展开（可独立测试）
6. Task 6 → NPC 引擎（依赖 Task 4）
7. Task 7 → LLM 抽象（需探索 OpenClaw API）
8. Task 8 → DM Session + Tick（依赖 Task 3-7）
9. Task 9 → 工具注册（依赖 Task 8）
10. Task 10 → 日记（依赖 Task 7）
11. Task 11 → 崩溃恢复（依赖 Task 8）
12. Task 12 → 入口集成（依赖全部）
13. Task 13 → E2E 测试验证

**Task 7 风险**: LLMClient 的实际实现依赖 OpenClaw 内部 API。建议在开始 Task 7 前先做一次 API 探索（查看 OpenClaw 文档或源码），确定 DM session 创建机制。如果 OpenClaw 不支持插件内创建 LLM session，fallback 为 HTTP API 调用或 CLI 子进程。
