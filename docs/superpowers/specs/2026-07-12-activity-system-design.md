# Activity 系统设计规格

**日期**: 2026-07-12
**状态**: 待审批
**概述**: 用 Activity 系统替换现有的 Event 系统——睦子米可以主动发起有时间长度的活动，DM 规划插曲，活动有持续时间、中间态和收尾。

---

## 一、动机

### 现有问题

1. Event 没有时间维度——handle 一下瞬间完成，没有真实的时间流逝感
2. 睦子米只能"处理" DM 创建的事件，没有主动性
3. 多个 handle_event 调用之间没有时间间隔——"处理中"→"继续处理"→"结束"是瞬时的
4. Event 预设数据（`data/events.json`）限制了 DM 的即兴创作

### 设计目标

- 睦子米可以主动发起有持续时间的活动
- 活动有真实的游戏时间长度
- 插曲是嵌入的叙事转折点，睦子米做出选择后不知道后果，要到下一个插曲或活动结束时才看到影响
- DM 即兴创作插曲，不需要预设数据

---

## 二、数据结构

### Activity（新增）

```typescript
interface Activity {
  id: string;
  name: string;                       // "菜园看黄瓜"
  brief: string;                      // 当前简报（DM 更新，等于 _dm.environment）
  status: "pending" | "active" | "paused";
  initiator: "dm" | "mutsumi";        // 谁发起的
  location: string;                   // 发生在哪个地点
  duration_minutes: number;           // 总时长（游戏分钟）
  elapsed_minutes: number;            // 已过的活动时间（暂停时冻结）
  started_at: string;                 // "HH:MM" 实际开始时间（pending 时为空）
  created_at: string;                 // "HH:MM" 活动创建时间
  interludes: Interlude[];            // DM 规划的小插曲，代码主动按 time_minutes 排序
}

interface Interlude {
  id: string;                         // "1", "2" ...
  time_minutes: number;               // 在活动开始后第几分钟触发
  description: string;                // DM 写的插曲场景描述（含自然问句）
  handled: boolean;                   // 睦子米是否已处理
  mutsumi_response?: string;          // 睦子米的回应（自由文本）
}
```

状态流转：

```
mutsumi 发起: (直接) → active → paused ⇄ active → 结束
dm 发起:     pending → active → paused ⇄ active → 结束
             pending → (被拒绝/超时取消)
```

### DMState 变化

```typescript
interface DMState {
  weather: string;
  schedule: ScheduleEntry[];
  environment: string;                // 活动期间始终等于 active_activity.brief
  active_activity: Activity | null;   // ← 替换 active_events: GameEvent[]
  dm_activity_count: number;          // 今天 DM 发起了几个活动（午夜 routine 重置为 0）
  last_dm_activity_time?: string;     // "HH:MM" 上次 DM 发起活动的时间（冷却用）
}
```

### 删除

- `GameEvent` 类型
- `EventDef` 类型
- `EventsData` 类型
- `RulesData` 中的 `event_selection`、`max_events_per_day`、`event_cooldown` 字段（`data/rules.json` 同步删除这三行）
- `data/events.json`
- `src/event-utils.ts`

### world.json 持久化

`active_activity` 完整（含 interludes、elapsed_minutes）写入 `world.json` 的 `_dm` 段。崩溃恢复时根据 `elapsed_minutes` 重建定时器——`elapsed_minutes` 是 truth，`setTimeout` 只是运行态投影。

### DM 发起活动

DM 在定时 tick 时可以输出 `activity_plan` 主动创建活动（替代旧的 `action: "event"` 和 `event`/`event_note`/`resolve_event_id` 字段）。

**DM 响应新增字段（仅在 DM 想创建活动时输出）：**

```json
{
  "environment": "...",
  "notify_mutsumi": "...",
  "activity_plan": {
    "name": "祥子路过菜园",
    "location": "菜园",
    "duration_minutes": 12,
    "initial_brief": "祥子出现在菜园门口，看到睦子米在浇水",
    "interludes": [
      { "time_minutes": 3, "description": "祥子走近，问睦最近有没有去练习，你怎么说？" },
      { "time_minutes": 8, "description": "两人聊到CRYCHIC的事，气氛有点微妙，你想继续聊还是换个话题？" }
    ]
  }
}
```

大多数 tick 不输出 `activity_plan`。

**数量控制：**

- 每日 DM 发起的活动 ≤ 2 个（代码强制，定义在 `dm-session.ts` 常量中）
- 两次 DM 发起活动之间 ≥ 30 分钟冷却（游戏时间）
- `dm_activity_count` 和 `last_dm_activity_time` 持久化在 `world.json` 中
- `dm_activity_count` 在午夜 routine 中重置为 0

**流程：**

```
DM tick → DM 输出 activity_plan
  ↓ 系统检测到 activity_plan
  校验：今天已发起 ≥ 2 个？冷却时间到了吗？→ 不满足则丢弃（记 log）
  满足 → 创建 Activity, status="pending", initiator="dm"
  notify 睦子米："[活动名] — [简报]。要不要参与？"
  ↓
睦子米 interact(response="去") → status="active", 开始计时
睦子米 interact(end=true)      → 取消, 记轨迹："没理会[活动名]"
睦子米 move_to 离开了          → 自动取消
现实 15 分钟无响应               → 自动取消
```

**DM System Prompt 更新：**

```
===== 活动系统 =====

—— DM 发起 activity_plan ——

你可以在定时 tick 时输出 activity_plan 来主动创建活动。
替换了旧的 action: "event"、event、event_note、resolve_event_id 字段——不再使用它们。

规则：
- 只在有意义的叙事时刻发起（NPC 偶遇、异常发现、环境变化）
- 平淡的日常 tick 不需要 activity_plan
- 如果当前已有活跃活动（包括 pending），不要再输出 activity_plan
- 睦子米可能会拒绝——这是她的自由，叙事上不要强迫
```

---

## 三、工具

### 新增

#### `do_activity` — 发起活动

```
参数:
  location: string           — "菜园"（必须是一个已知地点）
  description: string        — "想看看黄瓜长得怎么样了"
  duration_minutes?: number  — 预计时长（可选，不填则由 DM 决定）

前置条件:
  - 当前位置必须是 location（不能 traveling）
  - 当前位置必须等于 location（"你现在在XX，不在YY。先用 move_to 去 YY"）
  - 没有活跃活动（包括 pending——需先处理 pending 活动才能发起新的）

并发保护:
  - do_activity 有 inflight lock——DM 规划返回前不能再次调用

流程:
  1. 发 DM 规划请求。DM 返回:
     { "plan": { name, duration_minutes, initial_brief, interludes[] } }
     
     **注意**：睦子米发起时 DM 返回的 JSON 键名是 "plan"，
     与 DM tick 时主动输出的 "activity_plan" 是**两个不同的字段**——
     "plan" 是睦子米请求 DM 规划后的响应，"activity_plan" 是 DM 主动发起活动

  2. 校验 DM 返回：duration > 0，interlude 的 time_minutes 在 (0, duration)
     范围内且间隔 >= 8 分钟，无重复。代码主动对 interludes 按 time_minutes
     排序（不信任 DM 返回顺序）。不合法则重试一次（带上错误说明），
     两次失败返回错误消息给睦子米

  3. 创建 Activity, initiator="mutsumi", status="active"
  4. 记轨迹："开始：[活动名]（预计N分钟）"
  5. 停止定时 tick，启动活动计时器
  6. 初始化超时提醒机制（见下文）

返回:
  活动名 + 初始简报
```

#### `interact` — 回应插曲 / 接受活动 / 结束活动

```
参数:
  response?: string  — 回应文本（自由文本）。不提供 = 视为结束
  end?: boolean      — 显式结束活动

规则（按 activity 状态分支）:

  status="pending"（DM 发起的活动等待确认）:
    - 提供 response → 视为接受，status="active"，开始计时
    - 不提供 response / end=true → 拒绝，取消活动，记轨迹
    - 不在此状态 → 不走这个分支

  status="active" 且无待处理插曲:
    - end=true → 立即结束，DM 收尾
    - 否则 → "现在没有需要回应的插曲。如果想结束活动，请设置 end=true"

  status="paused" 且有待处理插曲:
    - 提供 response → 标记 handled，恢复计时，取消超时提醒器
    - 不提供 response / end=true → 跳到活动结束，未处理的插曲标记为跳过

  active_activity === null:
    → "现在没有进行中的活动"
```

### 删除

- `handle_event` — 被 `interact` 替代
- `dm_test_notify` — 临时测试工具

### 修改

#### `world_status` — 活动中加入活动信息

```
活动中返回：
  X月X日 星期X。天气XX。
  正在进行：[活动名]（还剩 N 分钟结束）
  环境：[当前 brief]
  下一段日程：[如有]
  今天：[轨迹...]

无活动时返回：
  X月X日 星期X。天气XX。
  位置：XX。
  环境：[_dm.environment]
  下一段日程：[如有]
  今天：[轨迹...]
```

不触发 DM tick。

#### `move_to` — 移动即结束

`move_to` 执行时检测到有活跃活动（包括 pending）→ 立即结束当前活动（DM 收尾），然后正常移动。移动开始的轨迹记录优先于活动结束记录。

---

## 四、计时机制

### 活动时钟

两层模型：

| 层 | 存储 | 作用 |
|----|------|------|
| 数据层 | `world.json` → `elapsed_minutes` | 持久化的 truth |
| 运行层 | 进程内存 → `setTimeout` | 根据 `elapsed_minutes` 和下一个里程碑计算 |

### 运行中

```
活动开始 → elapsed_minutes=0
→ 下一个里程碑 = interlude[0].time_minutes 或 duration_minutes
→ setTimeout(剩余_ms)
  ↓ 触发
→ 更新 elapsed_minutes → 写 world.json
→ 如果是插曲：
    a. 如果不是第一个插曲：调 DM 更新 brief（传入上一插曲的回应作为上下文）
       → DM 返回新 brief，写入 world.json
       如果是第一个插曲：跳过，沿用 initial_brief
    b. status="paused"，notify 睦子米（当前 brief + 插曲描述）
    c. 启动超时提醒器
→ 如果是结束：DM 收尾
  ↓ 睦子米 interact
→ 清除超时提醒器，status="active"
→ 下一个里程碑计算 → setTimeout(剩余_ms)
```

### 暂停时

- `elapsed_minutes` 冻结不动
- `setTimeout` 已清除
- 只有超时提醒器的 `setInterval`（每 5 分钟）在跑

### 超时提醒

```
插曲触发时：
  - notify 内容标注优先级
  - 启动超时提醒器：每 5 分钟 remind 一次
  - 第 1 次 remind → notify："你还需要处理[插曲描述]"
  - 第 2 次 remind → notify："如果再不处理，活动将自动结束"
  - 第 3 次 remind（累计 15 分钟）→ 自动结束，DM 收尾
睦子米 interact → 取消超时提醒器
```

### 崩溃恢复

```
读 world.json → active_activity：

1. 无 → 正常，跳过

2. status="pending"：
   - 恢复超时提醒器（从 created_at 算起，15 分钟后取消）

3. status="paused"：
   - 有待处理插曲 → 恢复超时提醒器，notify 睦子米

4. status="active"：
   - elapsed >= duration → DM 收尾（收尾 prompt 包含未触发的插曲列表，DM 知晓有 N 个插曲被跳过）
   - 下一个里程碑 = min(未触发的插曲时间, duration)
   - elapsed > 某插曲的 time_minutes（错过）→ 标记为"跳过"（handled=true, mutsumi_response="[错过]"）
   - setTimeout(下一里程碑 - elapsed)
```

---

## 五、结束条件

| 条件 | 行为 |
|------|------|
| `elapsed_minutes` 达到 `duration_minutes` | 正常结束，DM 收尾 |
| 睦子米 `interact` 中 end=true | 立即结束，DM 收尾 |
| 睦子米 `move_to`（去别的地方） | 立即结束，DM 收尾 |
| 插曲超时 3 次 remind（15 分钟现实时间） | 自动结束，DM 收尾 |
| DM 发起的 pending 活动 15 分钟无响应 | 自动取消（不触发 DM 收尾，记轨迹"没理会"） |
| Gateway 崩溃恢复时 elapsed >= duration | DM 收尾 |

所有收尾路径统一（代码侧）：
1. 发 DM 收尾请求（格式见下方）
2. DM 返回最终 brief（总结 + 结果）
3. notify 睦子米
4. 记轨迹："[活动名]结束。[最终 brief 摘要]"
5. `active_activity = null`
6. 恢复定时 tick，定时器重置为 15 分钟后

### DM 收尾 Prompt 格式

系统在活动收尾时向 DM 发送：

```
（活动结束了。以下是活动全过程，请写最终 brief 总结。）

活动名称：菜园看黄瓜
地点：菜园
持续时间：30 分钟（计划）/ 实际 30 分钟

过程回顾：
- 开始：蹲在菜园里，正观察黄瓜的生长情况
- [插曲1, 10min] 黄瓜叶子上趴着一只毛毛虫，叶子被啃了好几个洞
  睦子米的回应：轻轻把毛毛虫移到旁边的草地里
- [插曲2, 22min] 番茄架倒了在地上，几颗小番茄摔烂了
  睦子米的回应：把架子重新支起来，烂番茄埋土里做肥料
- [跳过] 如有未触发的插曲，标注为"未触发"
- [超时] 如因超时结束，标注"活动因超时自动结束"

请返回：
{
  "final_brief": "一句到三句的总结，以客观视角描述这次活动的结果和感受"
}
```

**特殊情况标注：**

- `move_to` 导致的结束：附加 "(睦子米中途离开了，去了[目的地])"
- 插曲超时导致的结束：附加 "(睦子米没有回应插曲，活动自动结束)"
- 睦子米主动结束（interact end=true）：附加 "(睦子米决定结束活动)"
- 崩溃恢复导致的结束：附加 "(世界重启，活动被迫中断)"

### DM System Prompt 收尾规则

在 DM system prompt 中加入：

```
—— 活动收尾 ——

活动结束时，你会收到活动全过程的回顾。请写 final_brief。

规则：
- 1-3 句话，总结本次活动的成果和感受
- 融入睦子米在插曲中做出的选择带来的影响
- 客观视角，不评判睦子米的选择好坏
- 如果是中途结束，自然带过不需要解释原因
```

---

## 六、DM 交互

### 两个 DM 交互场景的字段名区分

| 场景 | 谁调用 DM | DM 返回的 JSON 键名 | 说明 |
|------|----------|-------------------|------|
| 睦子米发起活动 | 系统在 do_activity 时调 DM | `{ "plan": { ... } }` | 请求 DM 规划活动 |
| DM 主动发起 | DM 在 tick 响应中自主输出 | `{ ..., "activity_plan": { ... } }` | DM 创建活动邀请 |

两者是不同的 JSON 字段，代码解析时各取各的。

### do_activity 规划

DM 收到规划请求后返回：

```json
{
  "plan": {
    "name": "菜园看黄瓜",
    "duration_minutes": 30,
    "initial_brief": "蹲在菜园里，正观察黄瓜的生长情况",
    "interludes": [
      {
        "time_minutes": 10,
        "description": "黄瓜叶子上趴着一只毛毛虫，叶子被啃了好几个洞，你要怎么做？"
      },
      {
        "time_minutes": 22,
        "description": "番茄架倒了在地上，几颗小番茄摔烂了，你想把架子重新支起来还是先不管？"
      }
    ]
  }
}
```

### DM System Prompt 完整新增

```
===== 活动系统 =====

—— 睦子米发起 do_activity ——

当睦子米发起 do_activity 时，你是导演，需要规划活动结构。
返回格式: { "plan": { name, duration_minutes, initial_brief, interludes[] } }

规则：
- 把她的意图转成具体的活动计划
- 插曲是即兴的转折点——不需要提前在 data 里定义
- 初始 brief 写她刚开始做什么
- 插曲 description 写她面临的场景 + 一个自然的问题收尾（不列选项）
- 插曲数量：平淡活动 0 个，正常活动 1-2 个
- 插曲间隔至少 8 分钟
- 如果睦子米没给时长，默认 15-30 分钟
- 如果 duration_minutes 参数存在，优先用它

—— DM 发起 activity_plan ——

你可以在定时 tick 时输出 activity_plan 来主动创建活动。
替换了旧的 action: "event"、event、event_note、resolve_event_id——不再使用它们。

规则：
- 只在有意义的叙事时刻发起（NPC 偶遇、异常发现、环境变化）
- 平淡的日常 tick 不需要 activity_plan
- 如果当前已有活跃活动（包括 pending），不要再输出 activity_plan
- 睦子米可能会拒绝——这是她的自由，叙事上不要强迫

—— 插曲推进 ——

当第 N 个插曲（N>1）到来时，brief 需要融入睦子米对第 N-1 个
插曲的回应所带来的影响。写的是"从现在往回看，大致发生了什么"，
不显式说"因为你选择了 X，所以 Y 发生了"。

—— 活动收尾 ——

活动结束时，写最终 brief 总结本次活动的成果和感受。
```

### 插曲通知格式

```
[DM 世界通知 — 需要回应]
[简报：当前的 brief]
[插曲：interlude.description]

（这是一个需要你处理的事件。用 interact 工具回应。
如果不知道怎么回应，可以用 world_status 看看当前状态。）
```

### 超时提醒通知格式

第 1 次：`[DM 世界通知 — 提醒] 你还需要处理：[插曲描述]`
第 2 次：`[DM 世界通知 — 提醒] 如果再不处理，活动将自动结束。[插曲描述]`
第 3 次：直接结束，不另通知。

---

## 七、定时 Tick 交互

- **活动期间**：定时 tick **关闭**。世界暂停，只有活动在推进。
- **活动结束后**：tick 定时器重置为 15 分钟后（不是立刻触发）。
- **午夜 routine**：检测到活跃活动时，推迟到活动结束后 5 分钟再执行。
- **午夜 routine 附加职责**：将 `dm_activity_count` 重置为 0。

---

## 八、现有代码变更清单

| 文件 | 变更 |
|------|------|
| `src/types.ts` | 新增 `Activity`, `Interlude`；`DMState` 中 `active_events: GameEvent[]` → `active_activity: Activity \| null` + `dm_activity_count: number` + `last_dm_activity_time?: string`；删除 `GameEvent`, `EventDef`, `EventsData`；`RulesData` 删除 `event_selection`, `max_events_per_day`, `event_cooldown` |
| `src/llm-client.ts` | **遗漏补充** — `DMResponse` 新增 `activity_plan?`、`plan?` 可选字段；action 联合类型移除 `"event"`；删除 `event_note`、`resolve_event_id` 字段 |
| `src/data-loader.ts` | 删除 events 加载 + `installDataFiles` 中的 events.json 复制；删除 `EventsData` 类型导入 |
| `src/world-state.ts` | `createEmptyWorld` 中 `active_events: []` → `active_activity: null` + `dm_activity_count: 0`；`DMState` 类型更新 |
| `src/dm-session.ts` | 新增 `handleDoActivity`（含 DM 规划请求 + 校验 + 重试）、`handleInteract`（三状态分支）；活动计时器 + 超时提醒器 + 崩溃恢复；修改 `tick()`——活动期间跳过 + 处理 DM 的 `activity_plan` 输出；修改 `applyDMResponse`——删除 event 处理逻辑，新增 activity_plan 处理；修改 `handleMoveTo`——移动前检测活跃活动并收尾；修改 `handleWorldStatus`——输出活动信息格式；修改 `buildDMSystemPrompt`——替换 event 相关 prompt 为 activity prompt；修改 `buildDMTickPrompt`——删除事件提示，加入活动上下文；修改 `midnightRoutine`——重置 `dm_activity_count`；修改 `startDMScheduler` 返回类型——删除 `handleEvent`/`handleTestNotify`；修改 `notifyMutsumi` 通知格式——适配插曲通知 |
| `src/tools.ts` | 删除 `handle_event`, `dm_test_notify`；新增 `do_activity`, `interact`；修改 `world_status` 工具描述；修改 `move_to` 工具描述 |
| `src/event-utils.ts` | **删除** |
| `src/index.ts` | 适配 `startDMScheduler` 新返回类型；删除 `event-utils` 导入 |
| `data/events.json` | **删除** |
| `data/rules.json` | 删除 `event_selection`, `max_events_per_day`, `event_cooldown` 三行 |

---

## 九、不可修改的规则

1. `_mutsumi` 段仍然是代码维护、睦子米只读
2. world.json 原子写（.tmp → rename）不变
3. 轨迹 facts only，不写感受
4. 步行速度 1.2 m/s 不变
5. 永远不修改 `SOUL.md`、`garden.md`、`inventory.md`、`funny-log.md`

---

## 十、端到端示例

### 睦子米发起活动

```
睦子米: do_activity(location="菜园", description="想看看黄瓜长得怎么样了", duration_minutes=30)
  ↓ 系统验证：已在菜园 ✓，无活跃活动 ✓，inflight lock 获取 ✓
  ↓ 发 DM 规划请求
DM 返回:
  { "plan": {
    "name": "菜园看黄瓜",
    "duration_minutes": 30,
    "initial_brief": "蹲在菜园里，正观察黄瓜的生长情况",
    "interludes": [
      [0] time_minutes=10: "黄瓜叶子上趴着一只毛毛虫，叶子被啃了好几个洞，你要怎么做？"
      [1] time_minutes=22: "番茄架倒了在地上，几颗小番茄摔烂了，你想把架子重新支起来还是先不管？"
    ]
  }}

系统: 校验通过（代码主动排序 interludes） → 创建 Activity, initiator="mutsumi", status="active"
记轨迹："开始：菜园看黄瓜（预计30分钟）"
停止定时 tick → 启动活动计时器 → setTimeout(10min)
World state: active_activity = { name:"菜园看黄瓜", brief:"蹲在菜园里...", ... }
返回: "菜园看黄瓜。蹲在菜园里，正观察黄瓜的生长情况。"

──────── 时间流逝 ────────

计时器达到 t=10:
  elapsed_minutes=10, status="paused"
  (第一个插曲，跳过 DM brief 更新，沿用 initial_brief)
  notify: "[DM 世界通知 — 需要回应]
           [简报：蹲在菜园里，正观察黄瓜的生长情况]
           [插曲：黄瓜叶子上趴着一只毛毛虫，叶子被啃了好几个洞，你要怎么做？]"
  启动超时提醒器（5min × 3）

睦子米: interact("轻轻把毛毛虫移到旁边的草地里")
  interlude[0].handled=true, mutsumi_response="轻轻把毛毛虫..."
  status="active", 取消超时提醒器
  下一个里程碑: interlude[1] at t=22, 还需12min
  setTimeout(12min)

──────── 时间流逝 ────────

计时器达到 t=22:
  elapsed_minutes=22
  调 DM 更新 brief（传入上一插曲回应："轻轻把毛毛虫移到旁边的草地里"）
  DM 返回新 brief: "黄瓜检查完了，移走毛毛虫后叶子没事了。正看番茄发现架子倒了。"
  写 world.json，environment = brief
  status="paused"
  notify: "[DM 世界通知 — 需要回应]
           [简报：黄瓜检查完了，移走毛毛虫后叶子没事了。正看番茄发现架子倒了。]
           [插曲：番茄架倒了在地上，几颗小番茄摔烂了，你想把架子重新支起来还是先不管？]"

睦子米: interact("把架子重新支起来，烂番茄埋土里做肥料")
  interlude[1].handled=true
  status="active"
  下一个里程碑: 结束 at t=30, 还需8min
  setTimeout(8min)

──────── 时间流逝 ────────

计时器达到 t=30:
  所有插曲已处理 → DM 收尾
  DM 最终 brief: "菜园看黄瓜结束。黄瓜长得不错，移走了一只毛毛虫，
                把被风吹倒的番茄架重新支好了，烂番茄埋了肥。"
  notify 睦子米
  记轨迹："菜园看黄瓜结束。黄瓜不错，移走毛毛虫，支好了番茄架。"
  active_activity = null
  恢复定时 tick，重置为 15 分钟后
```

### DM 发起活动

```
定时 tick → DM 在响应中输出:
  { "activity_plan": {
    "name": "祥子路过菜园",
    "location": "菜园",
    "duration_minutes": 12,
    "initial_brief": "祥子出现在菜园门口，看到睦子米在浇水",
    "interludes": [
      [0] time_minutes=3: "祥子走近问最近有没有去练习，你怎么说？"
      [1] time_minutes=8: "聊到CRYCHIC，气氛微妙，继续聊还是换个话题？"
    ]
  }}

系统: 校验通过（今天第 1 个 DM 活动，冷却满足）→ Activity, status="pending"
notify: "[DM 世界通知]
        祥子路过菜园 — 祥子出现在菜园门口，看到你在浇水。要不要参与？
        （用 interact 工具回应，或 ignore 忽略）"

睦子米: interact("放下水壶，走过去打招呼")
  status="active", initiator="dm", 开始计时
  记轨迹："参与：祥子路过菜园"
  → 后续同睦子米发起活动的流程一致

睦子米: interact(end=true)  [选择拒绝]
  取消 Activity, 记轨迹："没理会祥子路过菜园"
  active_activity = null
```

---

## 十一、已知的设计边界（Edge Cases 已处理）

| # | Edge Case | 处理 |
|---|-----------|------|
| 1 | Gateway 崩溃恢复 | Activity 持久化在 world.json；恢复时重建定时器或 DM 收尾 |
| 2 | 午夜跨活动 | midnight routine 推迟到活动结束后 5 分钟；活动跨越午夜时日期切换也推迟 |
| 3 | DM 规划不合法 | 校验 → 重试一次（带错误反馈）→ 仍失败则返回错误消息给睦子米 |
| 4 | 位置不匹配 | 系统拒绝："你现在在XX，不在YY。先用 move_to 去 YY" |
| 5 | 活动结束后 tick | tick 定时器重置为 15 分钟后 |
| 6 | 活动中 move_to | 立即结束当前活动（DM 收尾），然后正常移动 |
| 7 | 活动中 world_status | 不触发 DM tick，返回活动状态格式（含剩余时间） |
| 8 | 插曲期间超时 | 每 5 分钟 remind，3 次后自动收尾 |
| 9 | DM 发起的 pending 超时 | 15 分钟无响应自动取消 |
| 10 | do_activity 竞态 | inflight lock 防止并发调用 |
| 11 | 崩溃恢复时 elapsed 超过 duration 但有未处理插曲 | DM 收尾 prompt 包含跳过信息 |
| 12 | DM 返回的 interludes 乱序 | 代码主动按 time_minutes 排序 |
| 13 | 活动与日程冲突 | 日程是建议，活动优先。DM 可在叙事中提及后果 |
| 14 | 活动跨越午夜（23:50 开始 30min 活动） | midnight routine 推迟，日期切换推迟到活动结束后 |
