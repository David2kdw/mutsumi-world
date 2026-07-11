# Mutsumi World

若叶睦「楚门的世界」—— 一个为若叶睦（睦子米）QQ 机器人构建的数据驱动世界模拟引擎。

月之森学园及周边世界持续运转：代码管物理（路线、坐标、NPC 位置），DM LLM 管叙事（环境、事件、偶遇）。群友通过与睦子米在 QQ 上聊天来感知她的世界。

## 架构

```
┌─────────────────────────────────┐
│        mutsumi-world 插件        │
│                                 │
│  DM LLM (导演)   睦子米 LLM      │
│  模型: DeepSeek   模型: DeepSeek │
│  职责: 叙事        职责: 回复    │
│        │                │       │
│        ▼                ▼       │
│       world.json  ←→  4 个工具   │
│   _dm 读写 | _mutsumi 只读      │
└─────────────────────────────────┘
```

**关键分工**：代码算物理（Dijkstra 路由、坐标推进、NPC 日程），LLM 写叙事（环境渲染、事件创作、NPC 偶遇）。

## 快速开始

```bash
# 安装依赖
npm install

# 编译
npm run build

# 运行测试
npx tsx --test tests/*.test.ts
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API key（必需） |

### OpenClaw 部署

插件通过 OpenClaw 扩展系统加载：

1. 在 `~/.openclaw/extensions/` 下创建指向本仓库的符号链接
2. 在 `~/.openclaw/openclaw.json` 中添加 `"openclaw-mutsumi-world": { "enabled": true }`
3. 重启 Gateway：`openclaw gateway stop && openclaw gateway start`

## 世界系统

### 地图与路网

10 个地点（若叶家、丰川家、长崎家、校门、教室、中庭、菜园、音乐室、练习室、体育馆），通过 12 节点路网连接。代码用 Dijkstra 计算最短路径，坐标单位真实米，步行速度 1.2 m/s。

### 日程

模板日程 + 课表自动展开为完整的每日日程段（每节课 50 分钟 + 课间 10 分钟）。支持 weekday / saturday / sunday 三种模式。

### Tick 系统

- 每 10 分钟自动 tick（07:00-23:00）
- 07:00 晨间 routine：刷新天气、展开日程、创建 DM session
- 夜间不主动 tick，但工具调用仍可触发 DM

### NPC 系统

星露谷式——NPC 按日程在路网上移动，代码计算实时位置。DM 决定偶遇叙事。数据驱动：加 NPC 只需改 `data/npcs.json`。

### 事件系统

DM 在合适的时机创作事件，`events.json` 提供灵感参考。一天 ≤3 个新事件，同时 ≤3 个活跃。平淡的日常是常态。

### 崩溃恢复

- `world.json` 原子写（.tmp → rename）
- 重启时根据 `last_tick` 计算时间缺口，自动推进 traveling 坐标
- NPC 纯计算，无需恢复

## 四个工具

| 工具 | 说明 | 触发 DM |
|------|------|---------|
| `world_status` | 查看位置、天气、轨迹 | 否 |
| `check_schedule` | 查看当前及后续日程 | 否 |
| `observe_surroundings` | 观察周围环境 + 活跃事件 | 是 |
| `move_to` | 主动移动到某地点 | 是 |

## 项目结构

```
├── src/
│   ├── types.ts           — 25+ 类型定义
│   ├── data-loader.ts     — JSON 数据加载 + 安装复制
│   ├── world-state.ts     — world.json 原子读写
│   ├── map-engine.ts      — Dijkstra 路由 + 坐标插值
│   ├── schedule-engine.ts — 日程展开 + 时间段查询
│   ├── npc-engine.ts      — NPC 位置计算
│   ├── llm-client.ts      — DeepSeek API 客户端
│   ├── dm-session.ts      — DM 会话 + tick 调度
│   ├── tools.ts           — 4 个工具注册
│   ├── diary.ts           — 日记生成（LLM + 聊天记录）
│   ├── logger.ts          — 文件 + OpenClaw 双写日志
│   └── index.ts           — 插件入口
├── data/                  — 世界数据（JSON，用户可编辑）
├── tests/                 — 22 个单元 + E2E 测试
└── docs/superpowers/      — 设计规格 + 实现计划
```

## 日记

每日 23:30 自动生成：读取当日轨迹 + QQ 对话记录，以若叶睦口吻写 1-5 句日记。双写至 `workspace/memory/` 和插件内部 `diaries/`。
