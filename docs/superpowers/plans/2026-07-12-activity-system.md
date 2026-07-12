# Activity 系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Event system with an Activity system — Mutsumi can initiate time-duration activities, DM plans interludes, activities have real game-time duration with pause/resume/timeout, and crash recovery preserves state.

**Architecture:** Two-layer timing model — `elapsed_minutes` in `world.json` is the persisted truth, `setTimeout` in process memory is the runtime projection. Activities replace `active_events: GameEvent[]` with `active_activity: Activity | null`. DM returns `activity_plan` (self-initiated) or `plan` (Mutsumi-requested) as separate JSON keys. All activity-end paths funnel through a single unified wrap-up function.

**Tech Stack:** TypeScript, Node.js, DeepSeek API (OpenAI-compatible), OpenClaw plugin SDK

## Global Constraints

- Walking speed 1.2 m/s — never change
- world.json atomic write (.tmp → rename) — never change
- Trajectory facts only, no feelings — never change
- Never modify `SOUL.md`, `garden.md`, `inventory.md`, `funny-log.md`
- `_mutsumi` section is code-maintained, Mutsumi read-only
- Daily DM-initiated activities ≤ 2 (hard constant in dm-session.ts)
- DM activity cooldown ≥ 30 game-minutes between DM-initiated activities
- Tick interval 15 min real-time, 07:00-23:00 game-time

---

### Task 1: Update types — Add Activity/Interlude, remove GameEvent/EventDef/EventsData

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `Activity`, `Interlude` interfaces; updated `DMState` with `active_activity`, `dm_activity_count`, `last_dm_activity_time`; `RulesData` without event fields

- [ ] **Step 1: Replace GameEvent with Activity/Interlude, update DMState**

In `src/types.ts`, replace the `GameEvent` interface and update `DMState`:

```typescript
// ====== Activity (replaces GameEvent) ======

export interface Activity {
  id: string;
  name: string;
  brief: string;
  status: "pending" | "active" | "paused";
  initiator: "dm" | "mutsumi";
  location: string;
  duration_minutes: number;
  elapsed_minutes: number;
  started_at: string;        // "HH:MM" — empty when pending
  created_at: string;        // "HH:MM"
  interludes: Interlude[];
}

export interface Interlude {
  id: string;                // "1", "2" ...
  time_minutes: number;      // trigger at this elapsed minute mark
  description: string;
  handled: boolean;
  mutsumi_response?: string;
}
```

- [ ] **Step 2: Update DMState**

```typescript
export interface DMState {
  weather: string;
  schedule: ScheduleEntry[];
  environment: string;
  active_activity: Activity | null;
  dm_activity_count: number;
  last_dm_activity_time?: string;
}
```

- [ ] **Step 3: Delete GameEvent, EventDef, EventsData**

Remove these three interfaces entirely from `src/types.ts`:
- `GameEvent` (lines 25-41)
- `EventDef` (lines 138-150)
- `EventsData` (lines 152-154)

- [ ] **Step 4: Update RulesData — remove event fields**

```typescript
export interface RulesData {
  tone: string;
  environment_style: string;
  movement_policy: string;
  continuity: string;
  write_journal: boolean;
}
```

Removed: `event_selection`, `max_events_per_day`, `event_cooldown`.

- [ ] **Step 5: Build and verify types compile**

Run: `npm run build`
Expected: Type errors from other files referencing deleted types (these will be fixed in subsequent tasks).

---

### Task 2: Delete event-utils.ts and events.json, update rules.json

**Files:**
- Delete: `src/event-utils.ts`
- Delete: `data/events.json`
- Modify: `data/rules.json`

- [ ] **Step 1: Delete event-utils.ts**

Run: `rm src/event-utils.ts`

- [ ] **Step 2: Delete events.json**

Run: `rm data/events.json`

- [ ] **Step 3: Update rules.json — remove event fields**

Replace `data/rules.json` content:

```json
{
  "tone": "客观、不说教、叙事简洁。不评判角色内心——只描述外在发生了什么。你不是若叶睦，你是导演。",
  "environment_style": "沉浸式五感：看到的、听到的、闻到的、触感、氛围。1-3句话。",
  "movement_policy": "按日程走。可以因事件/天气/心情覆盖，但覆盖要有理由。大部分日子不改。",
  "continuity": "读前两日日记。注意未解决的剧情线。NPC 态度和近期互动保持一致。",
  "write_journal": false
}
```

Removed: `event_selection`, `max_events_per_day`, `event_cooldown` fields.

- [ ] **Step 4: Verify rules.json is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('data/rules.json','utf-8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add -u src/event-utils.ts data/events.json data/rules.json
git commit -m "feat: remove event system data — delete event-utils.ts, events.json, event rules fields"
```

---

### Task 3: Update data-loader.ts — remove event loading

**Files:**
- Modify: `src/data-loader.ts`

**Interfaces:**
- Produces: `installDataFiles` no longer copies events.json; `loadEvents` function removed

- [ ] **Step 1: Remove loadEvents function**

Delete the `loadEvents` function (lines 33-35):
```typescript
export function loadEvents(): EventsData {
  return readJSON<EventsData>(path.join(DATA_DIR, "events.json"));
}
```

- [ ] **Step 2: Remove EventsData from imports**

Change import:
```typescript
import type {
  LocationsData, RoadNetwork, ScheduleTemplate,
  WeatherData, NPCsData, RulesData,
} from "./types.js";
```

Removed: `EventsData` from the import.

- [ ] **Step 3: Remove events.json from installDataFiles**

In `installDataFiles`, remove `"events.json"` from the files array:
```typescript
const files = [
  "locations.json", "road_network.json", "schedule.json",
  "weather.json", "npcs.json", "rules.json",
];
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Compilation errors only in dm-session.ts and index.ts (which still reference events — fixed in later tasks).

---

### Task 4: Update LLM client types — add activity_plan/plan to DMResponse

**Files:**
- Modify: `src/llm-client.ts`

**Interfaces:**
- Produces: Updated `DMResponse` with `activity_plan?`, `plan?`; removed `event`, `event_note`, `resolve_event_id`

- [ ] **Step 1: Update DMResponse interface**

Replace the `DMResponse` interface:

```typescript
export interface DMResponse {
  action: "move" | "stay" | "none";
  environment?: string;
  // Activity: DM self-initiates via activity_plan
  activity_plan?: {
    name: string;
    location: string;
    duration_minutes: number;
    initial_brief: string;
    interludes: Array<{
      time_minutes: number;
      description: string;
    }>;
  };
  // Activity: Mutsumi requests DM to plan (DM returns "plan" key)
  plan?: {
    name: string;
    duration_minutes: number;
    initial_brief: string;
    interludes: Array<{
      time_minutes: number;
      description: string;
    }>;
  };
  move_to?: string;
  departure_note?: string;
  notify_mutsumi?: string | null;
}
```

Removed: `event`, `event_note`, `resolve_event_id` fields. Changed `action` union from `"move" | "stay" | "event" | "none"` to `"move" | "stay" | "none"`.

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Compilation errors only in dm-session.ts (applyDMResponse references deleted fields).

---

### Task 5: Update world-state.ts — new DMState shape in createEmptyWorld

**Files:**
- Modify: `src/world-state.ts`

- [ ] **Step 1: Update createEmptyWorld with new DMState fields**

```typescript
export function createEmptyWorld(date: string, dayType: "weekday" | "saturday" | "sunday"): WorldState {
  return {
    last_tick: "07:00",
    date,
    day_type: dayType,
    _dm: {
      weather: "",
      schedule: [],
      environment: "",
      active_activity: null,
      dm_activity_count: 0,
    },
    _mutsumi: {
      position: { type: "location", name: "家" },
      trajectory: [],
    },
  };
}
```

Changed: `active_events: []` → `active_activity: null` + `dm_activity_count: 0`.

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Compiles clean (assuming previous task fixes applied).

---

### Task 6: Update index.ts — remove event-utils import, new scheduler return type

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `startDMScheduler` new return type (no `handleEvent`/`handleTestNotify`, adds `handleDoActivity`/`handleInteract`)

- [ ] **Step 1: Update scheduler type annotation**

Change line 15:
```typescript
let _scheduler: ReturnType<typeof startDMScheduler> | null = null;
```

(This line stays the same — TypeScript infers the new type automatically. No code change needed here, but verify it compiles after all tasks.)

- [ ] **Step 2: Build and verify (after all dm-session changes)**

Will verify after Task 10 when dm-session.ts is fully updated.

---

### Task 7: Rewrite DM system prompt — activity prompts replace event prompts

**Files:**
- Modify: `src/dm-session.ts` — `buildDMSystemPrompt` function

- [ ] **Step 1: Replace buildDMSystemPrompt**

Replace the entire function body's output format section:

```typescript
function buildDMSystemPrompt(rules: RulesData, state: WorldState, npcs: NPCsData): string {
  const npcIntro = Object.entries(npcs).map(([id, def]) => {
    const parts = [`${def.display}（${id}）`];
    if (def.relationship) parts.push(`与睦的关系：${def.relationship}`);
    if (def.description) parts.push(def.description);
    return parts.join("\n  ");
  }).join("\n\n");

  return `你是月之森女子学园世界的导演。你的职责是客观描述这个世界的运转。

${rules.tone}

环境描写要求：${rules.environment_style}

移动策略：${rules.movement_policy}

连贯性要求：${rules.continuity}

当前日期：${state.date}（${state.day_type}）
当日天气：${state._dm.weather}

===== NPC 人物介绍 =====

${npcIntro || "（暂无 NPC 数据）"}

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
替换了旧的 event、event_note、resolve_event_id——不再使用它们。

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

活动结束时，你会收到活动全过程的回顾。请写 final_brief。

规则：
- 1-3 句话，总结本次活动的成果和感受
- 融入睦子米在插曲中做出的选择带来的影响
- 客观视角，不评判睦子米的选择好坏
- 如果是中途结束，自然带过不需要解释原因

===== 输出格式 =====

严格返回 JSON 对象，包含以下字段：
{
  "action": "move" | "stay" | "none",
  "environment": "新的环境描述（1-3句）",
  "move_to": "目标地点（仅当 action=move 时）",
  "departure_note": "出发轨迹说明（仅当 action=move 时）",
  "activity_plan": { "name": "...", "location": "...", "duration_minutes": N, "initial_brief": "...", "interludes": [{"time_minutes": N, "description": "..."}] },
  "notify_mutsumi": "需要通知睦子米时填写（一句话描述发生了什么），不需要时留 null"
}

大多数 tick 不输出 activity_plan。平淡的日子没关系。

当写 NPC 偶遇叙事时，参考上方的 NPC 人物介绍，让对话和行为符合人设。

===== 通知时机（notify_mutsumi） =====

填写 notify_mutsumi 的场景：
- 睦子米到达目的地了（告诉她周围有什么，她可能想记日记或探索）
- 新活动出现了（NPC 靠近、纸条、异常——她需要知道才能处理）
- 下一段日程快到了（当距离下一段日程开始 ≤ 15 分钟时，提醒睦子米）
- 环境发生显著变化（天气突变、铃声响起等）

留 null 的场景：
- 睦子米在睡觉且无事发生
- 环境没有变化，平淡的 tick
- 距离上次通知不到 10 分钟且无新情况`;
}
```

Key changes:
- Event principles section removed (was `${rules.event_selection}`)
- Event output fields (`event`, `event_note`, `resolve_event_id`) removed from output format
- Added full activity system section with 4 subsections
- `action` enum changed from `"move" | "stay" | "event" | "none"` to `"move" | "stay" | "none"`
- Added `activity_plan` field to output format
- Removed `resolve_event_id` and `event_note` from notification timing prose

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Errors from functions still referencing event types in dm-session.ts (fixed in subsequent tasks).

---

### Task 8: Rewrite DM tick prompt builder — activity context replaces event listings

**Files:**
- Modify: `src/dm-session.ts` — `buildDMTickPrompt` function

- [ ] **Step 1: Rewrite buildDMTickPrompt**

Replace the function:

```typescript
function buildDMTickPrompt(state: WorldState, ctx: TickContext, recentChat?: string): string {
  const pos = state._mutsumi.position;
  const posDesc = pos.type === "location"
    ? `目前在 ${pos.name}`
    : `正在从 ${pos.from} 去 ${pos.to} 的路上（进度 ${Math.round(pos.progress * 100)}%）`;

  let prompt = `当前时间：${ctx.time}
${posDesc}

今日轨迹：
${state._mutsumi.trajectory.map(t => `- ${t.time} ${t.note}`).join("\n")}
`;

  // Activity context replaces old "活跃事件" section
  const act = state._dm.active_activity;
  if (act) {
    const interludesStatus = act.interludes.map(i => {
      let status = i.handled ? "已处理" : "待触发";
      if (i.mutsumi_response) status += ` — 睦回应: ${i.mutsumi_response}`;
      return `- [${i.id}] ${i.time_minutes}min: ${i.description}（${status}）`;
    }).join("\n");
    prompt += `
活跃活动：${act.name}（${act.status}，${act.initiator}发起，位置：${act.location}，已过 ${act.elapsed_minutes}/${act.duration_minutes} 分钟）
简报：${act.brief}
插曲：
${interludesStatus || "（无）"}
`;
  } else {
    prompt += `\n活跃活动：无\n`;
  }

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

  if (recentChat) {
    prompt += `\n\n===== 群聊参考（不要编进环境叙事） =====
睦子米的世界状态检查附带了群聊上下文，仅供你了解她最近参与了什么话题。这些是外部信息，不是你导演的世界的一部分——不要在 environment 里描述群聊内容，也不要替群友编造新消息。
${recentChat}`;
  }

  return prompt;
}
```

Key changes:
- Removed `events?: EventsData` parameter
- Removed "活跃事件" section with `GameEvent` formatting
- Removed "当前位置可能发生的事件" section
- Added "活跃活动" section showing activity status, brief, and interludes
- Function signature simplified to `(state, ctx, recentChat?)`

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Errors from callers passing the old 4-argument `events` parameter (fixed in Task 10).

---

### Task 9: Rewrite applyDMResponse — remove event logic, add activity_plan handling

**Files:**
- Modify: `src/dm-session.ts` — `applyDMResponse` function

- [ ] **Step 1: Rewrite applyDMResponse**

Replace the function:

```typescript
function applyDMResponse(
  state: WorldState,
  response: DMResponse,
  time: string,
): Activity | null {
  // 更新环境
  if (response.environment) {
    state._dm.environment = response.environment;
  }

  // 处理移动决策
  if (response.action === "move" && response.move_to) {
    if (response.departure_note) {
      appendTrajectory(state, { time, note: response.departure_note });
    }
  }

  // 处理 DM 主动发起的 activity_plan
  if (response.activity_plan) {
    const plan = response.activity_plan;
    const activity: Activity = {
      id: `act-${Date.now()}`,
      name: plan.name,
      brief: plan.initial_brief,
      status: "pending",
      initiator: "dm",
      location: plan.location,
      duration_minutes: plan.duration_minutes,
      elapsed_minutes: 0,
      started_at: "",
      created_at: time,
      interludes: (plan.interludes || []).map((il, i) => ({
        id: String(i + 1),
        time_minutes: il.time_minutes,
        description: il.description,
        handled: false,
      })).sort((a, b) => a.time_minutes - b.time_minutes),
    };
    return activity;
  }

  return null;
}
```

Key changes:
- Removed `eventLookup: Map<string, EventDef>` parameter
- Removed `event_note` trajectory append
- Removed `event` merge/push logic
- Removed `resolve_event_id` filter logic
- Added `activity_plan` → `Activity` creation with sorted interludes
- Returns `Activity | null` — caller decides whether to set `active_activity`

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Errors from callers of `applyDMResponse` passing the old `eventLookup` argument (fixed in Task 10).

---

### Task 10: Core dm-session.ts rewrite — activity lifecycle, timers, recovery

**Files:**
- Modify: `src/dm-session.ts` — `startDMScheduler` function (the big one)

This is the core task. It rewrites the scheduler to handle the full activity lifecycle.

- [ ] **Step 1: Update imports — remove event imports, keep what's needed**

```typescript
import type {
  WorldState, ScheduleEntry, RouteResult, NPCState,
  Position, RulesData, TickContext, NPCsData, Activity, Interlude,
} from "./types.js";
import { readWorld, writeWorld, appendTrajectory, createEmptyWorld } from "./world-state.js";
import { findRoute, advanceTraveling } from "./map-engine.js";
import { findCurrentSegment, findNextSegment, expandSchedule, getDayType } from "./schedule-engine.js";
import { computeNPCStates } from "./npc-engine.js";
import { loadLocations, loadRoadNetwork, loadNPCs, loadRules, loadScheduleTemplate, loadWeather } from "./data-loader.js";
import { createLLMClient, type LLMClient, type DMSession, type DMResponse } from "./llm-client.js";
import { createLogger, type Logger } from "./logger.js";
import { saveDMSession, loadDMSession } from "./dm-store.js";
import { appendDiaryEntry } from "./diary.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
```

Removed: `EventsData`, `EventDef`, `buildEventLookup`, `mergeEvent` imports.

- [ ] **Step 2: Add constants at module level (after imports, before buildDMSystemPrompt)**

```typescript
// Activity system constants
const MAX_DM_ACTIVITIES_PER_DAY = 2;
const DM_ACTIVITY_COOLDOWN_MINUTES = 30;         // game-minutes between DM-initiated activities
const INTERLUDE_MIN_INTERVAL_MINUTES = 8;         // min spacing between interludes
const PENDING_TIMEOUT_REAL_MS = 15 * 60 * 1000;   // 15 real minutes for pending activity
const INTERLUDE_REMIND_INTERVAL_MS = 5 * 60 * 1000; // 5 real minutes between reminds
const MAX_INTERLUDE_REMINDS = 3;                   // 3 reminds → auto-end
```

- [ ] **Step 3: Rewrite startDMScheduler — new return type and internal structure**

This is the largest change. The new `startDMScheduler` body. Write the full function:

```typescript
export function startDMScheduler(
  api: OpenClawPluginApi,
  dataDir: string,
  workspaceDir: string,
): { stop: () => void; handleMoveTo: (location: string, reason?: string) => Promise<string>; handleDoActivity: (location: string, description: string, durationMinutes?: number) => Promise<string>; handleInteract: (response?: string, end?: boolean) => Promise<string>; handleWorldStatus: (recentChat?: string) => Promise<string>; handleWriteDiary: (text: string) => Promise<string> } {
  const log: Logger = createLogger(dataDir, api.logger);
  log.info("DM scheduler starting", { dataDir });

  const llmClient = createLLMClient();
  const locations = loadLocations();
  const network = loadRoadNetwork();
  const npcs = loadNPCs();
  const rules = loadRules();
  const weather = loadWeather();

  let dmSession: DMSession | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let midnightTimer: ReturnType<typeof setTimeout> | null = null;
  let diaryTimer: ReturnType<typeof setTimeout> | null = null;
  let activityTimer: ReturnType<typeof setTimeout> | null = null;
  let remindTimer: ReturnType<typeof setInterval> | null = null;
  let pendingTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDMTickTime: string | null = null;
  let doActivityInflight = false;
  const DM_TICK_COOLDOWN_MINUTES = 5;

  // ... (utility functions follow)
```

- [ ] **Step 4: Keep existing utility functions, add activity helpers**

Keep: `getMinutesSinceLastDMTick`, `markDMTick`, `getTime`, `getDate`, `pickWeather`, `advanceTravelingIfNeeded`
Remove: `applyDMResponse` (Task 9 already replaced it, now inlined differently)

Add new helper — unified activity end:

```typescript
  /** 清理所有活动相关定时器 */
  function clearActivityTimers(): void {
    if (activityTimer) { clearTimeout(activityTimer); activityTimer = null; }
    if (remindTimer) { clearInterval(remindTimer); remindTimer = null; }
    if (pendingTimeoutTimer) { clearTimeout(pendingTimeoutTimer); pendingTimeoutTimer = null; }
  }

  /** 统一的收尾请求 — 向 DM 发回顾并获取 final_brief */
  async function requestDMEndWrapUp(state: WorldState, reason: string): Promise<string> {
    const act = state._dm.active_activity!;
    if (!dmSession) return "活动结束。（DM 未连接）";

    const interludesReview = act.interludes.map(i => {
      const handledStr = i.handled
        ? `  睦子米的回应：${i.mutsumi_response || "（已处理）"}`
        : `  [未触发]`;
      return `- [插曲${i.id}, ${i.time_minutes}min] ${i.description}\n${handledStr}`;
    }).join("\n");

    const wrapPrompt = `（活动结束了。以下是活动全过程，请写最终 brief 总结。）

活动名称：${act.name}
地点：${act.location}
持续时间：${act.duration_minutes} 分钟（计划）/ 实际 ${act.elapsed_minutes} 分钟

过程回顾：
- 开始：${act.brief}
${interludesReview || "（无插曲）"}

${reason}

请返回：
{
  "final_brief": "一句到三句的总结，以客观视角描述这次活动的结果和感受"
}`;

    const resp = await dmSession.send(wrapPrompt);
    return resp.environment || "活动结束了。";
  }

  /** 统一的结束活动流程 */
  async function endActivity(state: WorldState, reason: string, reasonNote: string): Promise<void> {
    clearActivityTimers();
    const act = state._dm.active_activity!;
    const time = getTime();

    // 标记未处理的插曲为跳过
    for (const i of act.interludes) {
      if (!i.handled) {
        i.handled = true;
        i.mutsumi_response = i.mutsumi_response || "[跳过]";
      }
    }

    // DM 收尾
    let finalBrief = "";
    try {
      finalBrief = await requestDMEndWrapUp(state, reason);
    } catch (err) {
      log.warn(`Activity end wrap-up failed: ${String(err)}`);
      finalBrief = "活动结束。";
    }

    // notify
    notifyMutsumi(api, `[${act.name}] ${finalBrief}`, log);

    // 记轨迹
    appendTrajectory(state, { time, note: `${act.name}结束。${finalBrief.slice(0, 30)}` });

    // 清理
    state._dm.active_activity = null;
    state._dm.environment = finalBrief;
    state.last_tick = time;
    writeWorld(dataDir, state);

    // 恢复定时 tick
    scheduleTickTimer();

    log.info(`Activity ended: ${act.name} (${reasonNote})`);
  }

  /** 计算下一个里程碑（分钟） */
  function nextMilestoneMinutes(act: Activity): number {
    const nextInterlude = act.interludes
      .filter(i => !i.handled && i.time_minutes > act.elapsed_minutes)
      .sort((a, b) => a.time_minutes - b.time_minutes)[0];
    if (nextInterlude) return nextInterlude.time_minutes;
    return act.duration_minutes;
  }

  /** 启动活动计时器到下一个里程碑 */
  function scheduleActivityTimer(state: WorldState): void {
    if (activityTimer) clearTimeout(activityTimer);
    const act = state._dm.active_activity!;
    if (!act || act.status !== "active") return;

    const nextMs = nextMilestoneMinutes(act);
    const remaining = nextMs - act.elapsed_minutes;
    if (remaining <= 0) {
      // 已经过了 — 立即触发
      onActivityMilestone(state).catch(err => log.error(`Activity milestone error: ${String(err)}`));
      return;
    }

    // 游戏分钟映射到现实时间：1 游戏分钟 = 1 现实秒（方便测试和节奏感）
    const realDelayMs = remaining * 1000;
    activityTimer = setTimeout(() => {
      onActivityMilestone(state).catch(err => log.error(`Activity milestone error: ${String(err)}`));
    }, realDelayMs);
  }

  /** 到达活动里程碑（插曲或结束） */
  async function onActivityMilestone(state: WorldState): Promise<void> {
    const act = state._dm.active_activity!;
    if (!act || act.status !== "active") return;

    const nextMs = nextMilestoneMinutes(act);
    act.elapsed_minutes = nextMs;
    writeWorld(dataDir, state);

    if (act.elapsed_minutes >= act.duration_minutes) {
      // 活动结束
      await endActivity(state, "", "natural end");
      return;
    }

    // 触发插曲
    const interlude = act.interludes.find(i => i.time_minutes === nextMs && !i.handled);
    if (!interlude) {
      // 没有匹配的插曲 — 继续到下一个里程碑
      scheduleActivityTimer(state);
      return;
    }

    // 如果不是第一个插曲，先调 DM 更新 brief
    const isFirst = act.interludes.filter(i => i.handled).length === 0;
    if (!isFirst && dmSession) {
      const prevHandled = act.interludes.filter(i => i.handled);
      const lastResponse = prevHandled[prevHandled.length - 1]?.mutsumi_response || "";
      const updatePrompt = `（插曲推进。睦子米对上一个插曲的回应是：${lastResponse}。请更新 brief，融入她的选择带来的影响。返回 { "environment": "新的简报" }）`;
      try {
        const resp = await dmSession.send(updatePrompt);
        if (resp.environment) {
          act.brief = resp.environment;
          state._dm.environment = resp.environment;
        }
      } catch (err) {
        log.warn(`Brief update failed: ${String(err)}`);
      }
    }

    // 暂停，通知睦子米
    act.status = "paused";
    writeWorld(dataDir, state);

    notifyMutsumi(api,
      `[需要回应]\n[简报：${act.brief}]\n[插曲：${interlude.description}]\n\n（这是一个需要你处理的事件。用 interact 工具回应。如果不知道怎么回应，可以用 world_status 看看当前状态。）`,
      log
    );

    // 启动超时提醒器
    startRemindTimer(state);
  }

  /** 启动超时提醒器（插曲暂停时） */
  function startRemindTimer(state: WorldState): void {
    if (remindTimer) clearInterval(remindTimer);
    let remindCount = 0;

    remindTimer = setInterval(() => {
      remindCount++;
      // 重新读 world 确认状态（可能已被 interact 处理）
      let current: WorldState;
      try { current = readWorld(dataDir); } catch { clearInterval(remindTimer!); return; }
      const act = current._dm.active_activity;
      if (!act || act.status !== "paused") { clearInterval(remindTimer!); remindTimer = null; return; }

      const pendingInterlude = act.interludes.find(i => !i.handled && i.time_minutes <= act.elapsed_minutes);
      if (!pendingInterlude) { clearInterval(remindTimer!); remindTimer = null; return; }

      if (remindCount === 1) {
        notifyMutsumi(api, `[提醒] 你还需要处理：[${pendingInterlude.description}]`, log);
      } else if (remindCount === 2) {
        notifyMutsumi(api, `[提醒] 如果再不处理，活动将自动结束。[${pendingInterlude.description}]`, log);
      } else {
        // 第 3 次 — 自动结束
        clearInterval(remindTimer!);
        remindTimer = null;
        endActivity(current, "（睦子米没有回应插曲，活动自动结束）", "timeout").catch(err =>
          log.error(`Timeout end failed: ${String(err)}`)
        );
      }
    }, INTERLUDE_REMIND_INTERVAL_MS);
  }

  /** 启动 pending 超时计时器 */
  function startPendingTimeout(state: WorldState): void {
    if (pendingTimeoutTimer) clearTimeout(pendingTimeoutTimer);
    pendingTimeoutTimer = setTimeout(() => {
      let current: WorldState;
      try { current = readWorld(dataDir); } catch { return; }
      const act = current._dm.active_activity;
      if (!act || act.status !== "pending") return;

      const time = getTime();
      appendTrajectory(current, { time, note: `没理会${act.name}` });
      current._dm.active_activity = null;
      current.last_tick = time;
      writeWorld(dataDir, current);
      pendingTimeoutTimer = null;
      scheduleTickTimer();
      log.info(`Pending activity cancelled (timeout): ${act.name}`);
    }, PENDING_TIMEOUT_REAL_MS);
  }
```

- [ ] **Step 5: Rewrite tick() — skip during activity, handle activity_plan**

```typescript
  async function tick(): Promise<void> {
    const time = getTime();
    const hour = new Date().getHours();

    let state: WorldState;
    try {
      state = readWorld(dataDir);
    } catch {
      log.warn("No world.json found, skipping tick");
      return;
    }

    advanceTravelingIfNeeded(state);

    // 活动期间跳过 tick
    if (state._dm.active_activity) {
      state.last_tick = time;
      writeWorld(dataDir, state);
      return;
    }

    // 夜间：有 traveling 才 tick，纯睡觉跳过
    if (hour < 7 || hour >= 23) {
      const hasActivity = state._mutsumi.position.type === "traveling";
      if (!hasActivity) {
        state.last_tick = time;
        writeWorld(dataDir, state);
        return;
      }
    }

    const ctx = buildTickContext(state, time, locations, network, npcs);

    if (dmSession) {
      const prompt = `（系统定时推进世界。这轮 tick 是自主发起的——如有值得通知睦子米的事，使用 notify_mutsumi。）\n\n${buildDMTickPrompt(state, ctx)}`;
      const response = await dmSession.send(prompt);
      log.info(`Tick ${time} → ${response.environment || "(无声)"}${response.activity_plan ? ` [活动: ${response.activity_plan.name}]` : ""}${response.notify_mutsumi ? ` [🔔 notify]` : " [🔇 silent]"}`);

      // applyDMResponse handles environment + departure_note
      const newActivity = applyDMResponse(state, response, time);

      // 处理 DM 主动发起的 activity_plan
      if (newActivity) {
        // 校验
        if (state._dm.dm_activity_count >= MAX_DM_ACTIVITIES_PER_DAY) {
          log.info(`DM activity_plan rejected: daily limit reached (${state._dm.dm_activity_count}/${MAX_DM_ACTIVITIES_PER_DAY})`);
        } else if (state._dm.last_dm_activity_time) {
          const [lh, lm] = state._dm.last_dm_activity_time.split(":").map(Number);
          const [ch, cm] = time.split(":").map(Number);
          const gap = (ch * 60 + cm) - (lh * 60 + lm);
          if (gap < DM_ACTIVITY_COOLDOWN_MINUTES) {
            log.info(`DM activity_plan rejected: cooldown (${gap}/${DM_ACTIVITY_COOLDOWN_MINUTES} min)`);
          } else {
            state._dm.active_activity = newActivity;
            state._dm.dm_activity_count++;
            state._dm.last_dm_activity_time = time;
            startPendingTimeout(state);
            notifyMutsumi(api, `${newActivity.name} — ${newActivity.brief}。要不要参与？（用 interact 工具回应，或设置 end=true 忽略）`, log);
            log.info(`DM activity_plan accepted: ${newActivity.name}`);
          }
        } else {
          state._dm.active_activity = newActivity;
          state._dm.dm_activity_count++;
          state._dm.last_dm_activity_time = time;
          startPendingTimeout(state);
          notifyMutsumi(api, `${newActivity.name} — ${newActivity.brief}。要不要参与？（用 interact 工具回应，或设置 end=true 忽略）`, log);
          log.info(`DM activity_plan accepted: ${newActivity.name}`);
        }
      }

      if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
      saveDMSessionState(dataDir, state.date, dmSession, log);
    }

    state.last_tick = time;
    markDMTick(time);
    writeWorld(dataDir, state);
  }
```

- [ ] **Step 6: Rewrite handleMoveTo — end activity before moving**

```typescript
    async handleMoveTo(location: string, reason?: string): Promise<string> {
      const state = readWorld(dataDir);
      const wasTraveling = state._mutsumi.position.type === "traveling";
      advanceTravelingIfNeeded(state);
      const arrived = wasTraveling && state._mutsumi.position.type === "location";
      const time = getTime();

      // 有活跃活动 → 先结束再移动
      if (state._dm.active_activity) {
        const actName = state._dm.active_activity.name;
        await endActivity(state, `（睦子米中途离开了，去了${location}）`, "move_to");
        // endActivity 已重写 state，重新读
        const fresh = readWorld(dataDir);
        Object.assign(state, fresh);
        appendTrajectory(state, { time, note: reason ? `出发去${location}：${reason}` : `出发去${location}` });
        // 恢复 tick timer（endActivity 已调用 scheduleTickTimer，但轨迹需要写回）
      }

      // 如果上段 traveling 刚到达，强制触发到达场景 DM tick
      if (arrived && dmSession) {
        const ctx = buildTickContext(state, time, locations, network, npcs);
        const prompt = buildDMTickPrompt(state, ctx) + "\n（睦子米刚到目的地，请描述到达时的场景。）";
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time);
        if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
        markDMTick(time);
        log.info(`Arrival DM tick at ${(state._mutsumi.position as {type:"location";name:string}).name} → ${response.environment || "(无)"}${response.notify_mutsumi ? " [🔔 notify]" : " [🔇 silent]"}`);
      }

      const currentLoc = state._mutsumi.position.type === "location"
        ? state._mutsumi.position.name
        : state._mutsumi.position.to;

      // 不能移动到已在的位置
      if (currentLoc === location) {
        return `你已经在${location}了。`;
      }

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

      // 出发场景 DM tick（强制）
      if (dmSession) {
        const prompt = `当前时间：${time}。睦子米刚从${currentLoc}出发去${location}${reason ? `（${reason}）` : ""}。请描述她动身离开${currentLoc}时的场景。不要描述目的地——她还没到。`;
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time);
        if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
        saveDMSessionState(dataDir, state.date, dmSession, log);
        markDMTick(time);
      }

      state.last_tick = time;
      writeWorld(dataDir, state);

      const minutes = Math.round(route.estimatedMinutes);

      // 预定到达时自动触发 tick
      const estimatedMs = Math.round(route.estimatedMinutes * 60 * 1000);
      if (estimatedMs > 0 && estimatedMs < 60 * 60 * 1000) {
        const targetLocation = location;
        setTimeout(async () => {
          try {
            let s: WorldState;
            try { s = readWorld(dataDir); } catch { return; }
            if (s._mutsumi.position.type !== "traveling" || s._mutsumi.position.to !== targetLocation) return;
            advanceTravelingIfNeeded(s);
            const t = getTime();
            const pos = s._mutsumi.position as unknown as { type: string; name: string };
            if (pos.type === "location" && dmSession) {
              const ctx = buildTickContext(s, t, locations, network, npcs);
              const prompt = buildDMTickPrompt(s, ctx) + "\n（睦子米到达了目的地，请描述到达时的场景。）";
              const resp = await dmSession.send(prompt);
              applyDMResponse(s, resp, t);
              if (resp.notify_mutsumi) notifyMutsumi(api, resp.notify_mutsumi, log);
              saveDMSessionState(dataDir, s.date, dmSession, log);
              markDMTick(t);
              log.info(`Scheduled arrival at ${targetLocation} → ${resp.environment || "(无)"}${resp.notify_mutsumi ? " [🔔 notify]" : " [🔇 silent]"}`);
            }
            s.last_tick = t;
            writeWorld(dataDir, s);
          } catch (err) {
            log.warn(`Scheduled arrival tick failed: ${String(err)}`);
          }
        }, estimatedMs);
      }

      return `正在从${currentLoc}去${location}的路上。步行约${minutes}分钟。`;
    },
```

- [ ] **Step 7: Add handleDoActivity**

```typescript
    async handleDoActivity(location: string, description: string, durationMinutes?: number): Promise<string> {
      if (doActivityInflight) {
        return "上一个活动请求还在处理中，请稍后再试。";
      }
      doActivityInflight = true;

      try {
        const state = readWorld(dataDir);
        advanceTravelingIfNeeded(state);
        const time = getTime();

        // 前置条件校验
        const currentLoc = state._mutsumi.position.type === "location"
          ? state._mutsumi.position.name
          : null;
        if (!currentLoc) {
          return "你现在在路上，不能发起活动。先到达目的地再说。";
        }
        if (currentLoc !== location) {
          return `你现在在${currentLoc}，不在${location}。先用 move_to 去 ${location}。`;
        }
        if (state._dm.active_activity) {
          return `现在已经有活动正在进行中（${state._dm.active_activity.name}）。先结束当前活动再发起新的。`;
        }

        if (!dmSession) {
          return "DM 未连接，无法规划活动。";
        }

        // 发 DM 规划请求
        const planPrompt = `（睦子米想在${location}发起一个活动：${description}${durationMinutes ? `，她预计需要${durationMinutes}分钟` : "，她没有指定时长"}。请以导演身份规划这个活动的结构。）`;
        let response = await dmSession.send(planPrompt);
        saveDMSessionState(dataDir, state.date, dmSession, log);

        // 校验 plan 字段
        let plan = response.plan;
        if (!plan) {
          // 重试一次
          const retryPrompt = `（上一次你没有返回 plan 字段。请务必以 JSON 格式返回 { "plan": { "name": "...", "duration_minutes": N, "initial_brief": "...", "interludes": [...] } }。睦子米想在${location}：${description}）`;
          response = await dmSession.send(retryPrompt);
          saveDMSessionState(dataDir, state.date, dmSession, log);
          plan = response.plan;
        }

        if (!plan) {
          return "DM 无法规划这个活动，请换个方式试试。";
        }

        // 校验字段
        if (!plan.name || !plan.initial_brief) {
          return "DM 规划不完整，缺少名称或初始简报。请重试。";
        }

        let duration = plan.duration_minutes || (durationMinutes || 20);
        if (duration <= 0) duration = 20;

        // 排序 interludes，过滤不合法时间
        const interludes: Interlude[] = (plan.interludes || [])
          .filter(il => il.time_minutes > 0 && il.time_minutes < duration)
          .map((il, i) => ({
            id: String(i + 1),
            time_minutes: il.time_minutes,
            description: il.description,
            handled: false,
          }))
          .sort((a, b) => a.time_minutes - b.time_minutes);

        // 检验插曲间隔 >= 8 分钟
        let sortedTimes = interludes.map(i => i.time_minutes);
        // prepend 0 as the start
        sortedTimes = [0, ...sortedTimes, duration];
        for (let i = 1; i < sortedTimes.length; i++) {
          if (sortedTimes[i] - sortedTimes[i - 1] < INTERLUDE_MIN_INTERVAL_MINUTES) {
            log.warn(`Interlude spacing violation: ${sortedTimes[i]} - ${sortedTimes[i-1]} < ${INTERLUDE_MIN_INTERVAL_MINUTES}`);
          }
        }

        // 创建 Activity
        const activity: Activity = {
          id: `act-${Date.now()}`,
          name: plan.name,
          brief: plan.initial_brief,
          status: "active",
          initiator: "mutsumi",
          location,
          duration_minutes: duration,
          elapsed_minutes: 0,
          started_at: time,
          created_at: time,
          interludes,
        };

        state._dm.active_activity = activity;
        state._dm.environment = plan.initial_brief;
        appendTrajectory(state, { time, note: `开始：${activity.name}（预计${duration}分钟）` });

        // 停止定时 tick
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }

        writeWorld(dataDir, state);

        // 启动活动计时器
        scheduleActivityTimer(state);

        log.info(`Activity started (mutsumi): ${activity.name} at ${location}, ${duration}min, ${interludes.length} interludes`);

        return `${activity.name}。${plan.initial_brief}`;
      } finally {
        doActivityInflight = false;
      }
    },
```

- [ ] **Step 8: Add handleInteract**

```typescript
    async handleInteract(response?: string, end?: boolean): Promise<string> {
      const state = readWorld(dataDir);
      advanceTravelingIfNeeded(state);
      const time = getTime();
      const act = state._dm.active_activity;

      if (!act) {
        return "现在没有进行中的活动。";
      }

      // Branch 1: pending (DM-initiated waiting for confirmation)
      if (act.status === "pending") {
        if (end || !response) {
          // 拒绝
          appendTrajectory(state, { time, note: `没理会${act.name}` });
          state._dm.active_activity = null;
          clearActivityTimers();
          writeWorld(dataDir, state);
          scheduleTickTimer();
          return `没理会「${act.name}」。`;
        }
        // 接受
        act.status = "active";
        act.started_at = time;
        act.elapsed_minutes = 0;
        appendTrajectory(state, { time, note: `参与：${act.name}` });
        if (pendingTimeoutTimer) { clearTimeout(pendingTimeoutTimer); pendingTimeoutTimer = null; }
        // 停止 tick timer
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        writeWorld(dataDir, state);
        scheduleActivityTimer(state);
        return `你接受了「${act.name}」。${act.brief}`;
      }

      // Branch 2: active but no pending interlude
      if (act.status === "active") {
        const pendingInterlude = act.interludes.find(i => !i.handled && i.time_minutes <= act.elapsed_minutes);
        if (!pendingInterlude) {
          if (end) {
            await endActivity(state, "（睦子米决定结束活动）", "mutsumi end");
            return "活动已结束。";
          }
          return "现在没有需要回应的插曲。如果想结束活动，请设置 end=true。";
        }
        // 有已触发的未处理插曲（边缘情况：插曲已到但 status 未即时切换）
        // fall through to paused logic below
      }

      // Branch 3: paused with pending interlude
      if (act.status === "paused") {
        const pendingInterlude = act.interludes.find(i => !i.handled && i.time_minutes <= act.elapsed_minutes);

        if (end || !response) {
          // 结束活动，跳过未处理的插曲
          if (pendingInterlude) {
            pendingInterlude.handled = true;
            pendingInterlude.mutsumi_response = "[跳过]";
          }
          // 标记所有未处理插曲为跳过
          for (const i of act.interludes) {
            if (!i.handled) {
              i.handled = true;
              i.mutsumi_response = "[跳过]";
            }
          }
          await endActivity(state, "（睦子米决定结束活动）", "mutsumi end");
          return "活动已结束。";
        }

        if (!pendingInterlude) {
          // 没有待处理插曲（边缘情况）→ 恢复
          act.status = "active";
          writeWorld(dataDir, state);
          scheduleActivityTimer(state);
          return "已恢复活动。";
        }

        // 处理插曲
        pendingInterlude.handled = true;
        pendingInterlude.mutsumi_response = response || "（已处理）";
        act.status = "active";

        // 取消超时提醒
        if (remindTimer) { clearInterval(remindTimer); remindTimer = null; }

        writeWorld(dataDir, state);
        scheduleActivityTimer(state);

        return `已处理。继续活动中（还剩约 ${act.duration_minutes - act.elapsed_minutes} 分钟）。`;
      }

      return "未知的活动状态。";
    },
```

- [ ] **Step 9: Rewrite handleWorldStatus — activity format**

```typescript
    async handleWorldStatus(recentChat?: string): Promise<string> {
      const state = readWorld(dataDir);
      advanceTravelingIfNeeded(state);
      const time = getTime();

      // 活动期间不触发 DM tick
      const hasActivity = !!state._dm.active_activity;
      const shouldTick = !hasActivity && getMinutesSinceLastDMTick(time) >= DM_TICK_COOLDOWN_MINUTES;
      if (dmSession && shouldTick) {
        const ctx = buildTickContext(state, time, locations, network, npcs);
        const prompt = `（睦子米查看了世界状态——她主动发起的，不需要 notify_mutsumi。）\n\n${buildDMTickPrompt(state, ctx, recentChat)}`;
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time);
        saveDMSessionState(dataDir, state.date, dmSession, log);
        markDMTick(time);
        log.info(`world_status DM tick → ${response.environment || "(无声)"} [🔇 skip notify]`);
      }

      state.last_tick = time;
      writeWorld(dataDir, state);

      const now = new Date();
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

      // 活动中格式
      const act = state._dm.active_activity;
      if (act) {
        const remaining = act.status === "paused"
          ? act.duration_minutes - act.elapsed_minutes
          : Math.max(0, act.duration_minutes - act.elapsed_minutes);
        const nextSegment = findNextSegment(state._dm.schedule, time);
        const nextScheduleLine = nextSegment
          ? `\n下一段日程：${nextSegment.start}-${nextSegment.end} ${nextSegment.location} | ${nextSegment.activity}`
          : "";

        return (
          `${now.getMonth() + 1}月${now.getDate()}日 星期${dayNames[now.getDay()]}。` +
          `天气${state._dm.weather}。` +
          `\n正在进行：${act.name}（还剩 ${remaining} 分钟结束，状态：${act.status === "paused" ? "等待回应" : "进行中"}）` +
          `\n环境：${act.brief}` +
          nextScheduleLine +
          `\n今天：${state._mutsumi.trajectory.map(t => `${t.time} ${t.note}`).join("；") || "今天还没有记录。"}`
        );
      }

      // 无活动格式
      const pos = state._mutsumi.position;
      const posDesc = pos.type === "location"
        ? pos.name
        : `正在从${pos.from}去${pos.to}的路上`;

      const trajSummary = state._mutsumi.trajectory.length > 0
        ? state._mutsumi.trajectory.map(t => `${t.time} ${t.note}`).join("；")
        : "今天还没有记录。";

      const nextSegment = findNextSegment(state._dm.schedule, time);
      const nextScheduleLine = nextSegment
        ? `\n下一段日程：${nextSegment.start}-${nextSegment.end} ${nextSegment.location} | ${nextSegment.activity}`
        : "";

      return (
        `${now.getMonth() + 1}月${now.getDate()}日 星期${dayNames[now.getDay()]}。` +
        `天气${state._dm.weather}。` +
        `位置：${posDesc}。` +
        `\n环境：${state._dm.environment}` +
        nextScheduleLine +
        `\n今天：${trajSummary}`
      );
    },
```

- [ ] **Step 10: Add scheduleTickTimer helper, update midnightRoutine**

```typescript
  /** 启动/恢复定时 tick（15 分钟后触发） */
  function scheduleTickTimer(): void {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  }
```

Update midnightRoutine — add `dm_activity_count` reset and activity-aware scheduling:

```typescript
  async function midnightRoutine(): Promise<void> {
    const date = getDate();
    const dayType = getDayType(date);

    log.info(`Midnight routine: ${date} (${dayType})`);

    let state: WorldState;
    let isNew = false;
    try {
      state = readWorld(dataDir);
    } catch {
      state = createEmptyWorld(date, dayType);
      isNew = true;
    }

    // 有活跃活动 → 推迟到活动结束后 5 分钟
    if (!isNew && state._dm.active_activity) {
      log.info(`Midnight routine postponed: activity "${state._dm.active_activity.name}" is active`);
      // 5 分钟后重试
      midnightTimer = setTimeout(() => midnightRoutine(), 5 * 60 * 1000);
      return;
    }

    if (!isNew && state.date === date) return;

    state.date = date;
    state.day_type = dayType;
    state._dm.weather = pickWeather();

    const scheduleTemplate = loadScheduleTemplate();
    state._dm.schedule = expandSchedule(scheduleTemplate, date);

    // 新的一天，重置计数和轨迹
    state._dm.dm_activity_count = 0;
    state._dm.last_dm_activity_time = undefined;
    state._mutsumi.trajectory = [];

    // 创建新的 DM session + 初始 tick
    if (dmSession) dmSession.close();
    const sysPrompt = buildDMSystemPrompt(rules, state, npcs);
    dmSession = llmClient.dmChat(sysPrompt);

    const time = getTime();
    const ctx = buildTickContext(state, time, locations, network, npcs);
    const prompt = `（系统：新的一天开始了。）\n\n${buildDMTickPrompt(state, ctx)}`;
    const response = await dmSession.send(prompt);
    log.info(`DM midnight → ${response.environment || "(无环境描述)"}${response.notify_mutsumi ? " [🔔 notify]" : " [🔇 silent]"}`);

    applyDMResponse(state, response, time);
    if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
    state.last_tick = time;
    writeWorld(dataDir, state);
    saveDMSessionState(dataDir, date, dmSession, log);
    log.info(`Midnight complete. Weather: ${state._dm.weather}, Schedule: ${state._dm.schedule.length} segments`);
  }
```

- [ ] **Step 11: Rewrite crash recovery — activity-aware**

```typescript
  export async function recoverFromCrash(
    dataDir: string,
    locations: ReturnType<typeof loadLocations>,
    network: ReturnType<typeof loadRoadNetwork>,
    npcs: ReturnType<typeof loadNPCs>,
  ): Promise<WorldState | null> {
    let state: WorldState;
    try {
      state = readWorld(dataDir);
    } catch {
      return null;
    }

    if (!state.last_tick) return state;

    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const [lastH, lastM] = state.last_tick.split(":").map(Number);
    const [nowH, nowM] = nowTime.split(":").map(Number);
    let gapMs = ((nowH * 60 + nowM) - (lastH * 60 + lastM)) * 60 * 1000;
    if (gapMs < 0) gapMs += 24 * 60 * 60 * 1000;
    if (gapMs <= 0) return state;

    // 推进 traveling
    if (state._mutsumi.position.type === "traveling") {
      const route = state._mutsumi.position.route;
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

    // 活动崩溃恢复（由调用方在 dm-session 闭包内处理，这里只保留 world state）
    // 调用方会在启动时检查 active_activity 并恢复定时器

    if (gapMs > 15 * 60 * 1000) {
      appendTrajectory(state, {
        time: nowTime,
        note: `世界恢复运行（上次 tick: ${state.last_tick}）`,
      });
    }

    state.last_tick = nowTime;
    writeWorld(dataDir, state);

    return state;
  }
```

- [ ] **Step 12: Rewrite startup logic — activity recovery after crash**

Replace the `(async () => { ... })()` startup block:

```typescript
  // 启动时恢复或初始化世界
  (async () => {
    let state = await recoverFromCrash(dataDir, locations, network, npcs);
    if (!state) {
      await midnightRoutine();
    } else {
      log.info(`Recovered from crash. Last tick was ${state.last_tick}`);

      if (state.date === getDate()) {
        // 当天：恢复 DM session
        const archive = loadDMSession(dataDir, state.date);
        if (archive && archive.history.length > 0) {
          const sysPrompt = buildDMSystemPrompt(rules, state, npcs);
          const history = [...archive.history];
          if (history[0]?.role === "system") {
            history[0] = { role: "system", content: sysPrompt };
          }
          dmSession = llmClient.restoreDMSession(history);
          log.info(`DM session restored: ${history.length} messages from ${archive.saved_at}`);
        } else {
          await midnightRoutine();
        }

        // 恢复活动状态
        const act = state._dm.active_activity;
        if (act) {
          if (act.status === "pending") {
            startPendingTimeout(state);
            log.info(`Activity recovery: pending "${act.name}" — timeout resumed`);
          } else if (act.status === "paused") {
            const pendingInterlude = act.interludes.find(i => !i.handled && i.time_minutes <= act.elapsed_minutes);
            if (pendingInterlude) {
              notifyMutsumi(api, `[需要回应 — 世界恢复]\n[简报：${act.brief}]\n[插曲：${pendingInterlude.description}]`, log);
              startRemindTimer(state);
              log.info(`Activity recovery: paused "${act.name}" — remind resumed`);
            }
          } else if (act.status === "active") {
            if (act.elapsed_minutes >= act.duration_minutes) {
              // 已经超时 — 收尾
              const missedInterludes = act.interludes.filter(i => !i.handled);
              let reason = "（世界重启，活动被迫中断）";
              if (missedInterludes.length > 0) {
                reason += `\n[跳过] 以下插曲未触发：${missedInterludes.map(i => i.description).join("；")}`;
              }
              await endActivity(state, reason, "crash-recovery");
              log.info(`Activity recovery: "${act.name}" elapsed ${act.elapsed_minutes}/${act.duration_minutes} — ended`);
            } else {
              // 继续计时
              scheduleActivityTimer(state);
              log.info(`Activity recovery: active "${act.name}" at ${act.elapsed_minutes}/${act.duration_minutes} — timer resumed`);
            }
          }
        }
      } else {
        await midnightRoutine();
      }
    }
  })();

  scheduleMidnight();
  scheduleTickTimer();

  // ... (pickWeather, return block follows)
```

- [ ] **Step 13: Update return block**

```typescript
  return {
    stop() {
      log.info("DM scheduler stopping");
      if (tickTimer) clearInterval(tickTimer);
      clearActivityTimers();
      if (midnightTimer) clearTimeout(midnightTimer);
      if (diaryTimer) clearTimeout(diaryTimer);
      if (dmSession) dmSession.close();
    },
    handleMoveTo,
    handleDoActivity,
    handleInteract,
    handleWorldStatus,
    async handleWriteDiary(text: string): Promise<string> {
      await appendDiaryEntry(dataDir, workspaceDir, text);
      return "记下了。";
    },
  };
```

Removed: `handleEvent`, `handleTestNotify`.

- [ ] **Step 14: Build and verify**

Run: `npm run build`
Expected: All compilation errors resolved. If there are errors, fix them.

---

### Task 11: Update tools.ts — replace handle_event/dm_test_notify with do_activity/interact

**Files:**
- Modify: `src/tools.ts`

- [ ] **Step 1: Update imports and scheduler return type**

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { readWorld } from "./world-state.js";
import { findCurrentSegment } from "./schedule-engine.js";
import type { WorldState } from "./types.js";
import type { Logger } from "./logger.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}
```

No import changes needed — TypeScript infers the scheduler return type.

- [ ] **Step 2: Replace handle_event tool with interact tool**

Remove the `handle_event` tool registration block (lines 116-146) and replace with:

```typescript
  // ====== do_activity ======
  api.registerTool({
    name: "do_activity",
    label: "发起活动",
    description: "在当前地点发起一个有持续时间的活动——做园艺、练习、看书、发呆等。DM会规划活动的结构和可能发生的小插曲。只在你想主动做某事时使用。",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "活动地点（必须是你当前所在的位置）",
          enum: ["教室", "菜园", "中庭", "音乐室", "家", "练习室", "体育馆", "校门"],
        },
        description: {
          type: "string",
          description: "你想做什么——例如「想看看黄瓜长得怎么样了」「想练一会儿吉他」",
        },
        duration_minutes: {
          type: "number",
          description: "预计多长时间（分钟，可选，不填则由DM决定）",
        },
      },
      required: ["location", "description"],
    },
    async execute(_toolCallId, params) {
      const p = params as { location: string; description: string; duration_minutes?: number };
      log.info(`睦子米发起活动: ${p.description} @ ${p.location}${p.duration_minutes ? ` (${p.duration_minutes}min)` : ""}`);
      try {
        const result = await scheduler.handleDoActivity(p.location, p.description, p.duration_minutes);
        log.info(`睦子米 do_activity → ${result.slice(0, 100)}`);
        return textResult(result);
      } catch (err) {
        return textResult(`发起活动失败。${err instanceof Error ? err.message : ""}`);
      }
    },
  });

  // ====== interact ======
  api.registerTool({
    name: "interact",
    label: "回应活动/插曲",
    description: "回应DM发起的活动邀请，或处理活动中出现的插曲。用 response 参数表达你的选择/行动。如果不想参与DM发起的活动，传 end=true。想提前结束当前活动，也传 end=true。",
    parameters: {
      type: "object",
      properties: {
        response: {
          type: "string",
          description: "你的回应（自由文本）。例如「轻轻把毛毛虫移到旁边」「放下水壶走过去打招呼」",
        },
        end: {
          type: "boolean",
          description: "是否结束/拒绝活动。DM发起的活动传end=true表示拒绝；活动中传end=true表示提前结束",
        },
      },
    },
    async execute(_toolCallId, params) {
      const p = params as { response?: string; end?: boolean };
      log.info(`睦子米 interact: ${p.response || "(无响应)"} end=${p.end || false}`);
      try {
        const result = await scheduler.handleInteract(p.response, p.end);
        log.info(`睦子米 interact → ${result.slice(0, 100)}`);
        return textResult(result);
      } catch (err) {
        return textResult(`操作失败。${err instanceof Error ? err.message : ""}`);
      }
    },
  });
```

- [ ] **Step 3: Remove dm_test_notify tool**

Delete the `dm_test_notify` tool registration block (lines 176-191).

- [ ] **Step 4: Update world_status tool description and move_to tool description**

Update `world_status` description (line 22):
```typescript
    description: "查看当前时间、位置、天气、活动状态、今天发生了什么。当群友问「今天怎么样」「在哪」「做了什么」时先调用。如果群里最近在聊什么相关话题，用 recent_chat 参数简短附上。",
```

Update `move_to` description (line 87):
```typescript
    description: "主动去另一个地方。日常移动是自动的，只在你想改变行程时使用。如果在活动中移动，活动会自动结束。调用一次就够了——出发后用 world_status 看一次路上的场景，然后就回复群友，不需要反复 move_to 去已经在去的地方。",
```

- [ ] **Step 5: Update registered tools log count**

Change line 193:
```typescript
  api.logger?.info?.("[mutsumi-world] 5 tools registered");
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Full clean build, no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: replace Event system with Activity system"
```

---

### Task 12: Integration verification — build and smoke test

**Files:** None (verification only)

- [ ] **Step 1: Clean build**

Run: `npm run build`
Expected: Zero errors.

- [ ] **Step 2: Verify type consistency — review all inter-task interfaces**

Checklist:
- [ ] `DMResponse.action` is `"move" | "stay" | "none"` (no `"event"`) — all callers use only these
- [ ] `DMState.active_activity` is `Activity | null` — all reads null-check before use
- [ ] `applyDMResponse` returns `Activity | null` — all callers handle the return
- [ ] `buildDMTickPrompt` signature is `(state, ctx, recentChat?)` — all callers pass 3 args max
- [ ] `startDMScheduler` return type includes `handleDoActivity`, `handleInteract` but NOT `handleEvent`, `handleTestNotify`
- [ ] `tools.ts` registered tools match new names: `do_activity`, `interact`, NOT `handle_event`, `dm_test_notify`

- [ ] **Step 3: Verify data files**

Run: `ls data/`
Expected: `locations.json`, `road_network.json`, `schedule.json`, `weather.json`, `npcs.json`, `rules.json` (no `events.json`)

- [ ] **Step 4: Coverage check against spec**

Spec section → Task mapping:
- **§二 数据结构** → Task 1 (types), Task 5 (world-state), Task 4 (DMResponse)
- **§二 world.json 持久化** → Task 10 (activity timer writes world.json on milestones)
- **§二 DM 发起活动** → Task 9 (applyDMResponse activity_plan), Task 10 (tick activity_plan handling)
- **§二 DM System Prompt 更新** → Task 7 (buildDMSystemPrompt)
- **§三 do_activity 工具** → Task 11 (tools.ts), Task 10 (handleDoActivity)
- **§三 interact 工具** → Task 11 (tools.ts), Task 10 (handleInteract)
- **§三 删除 handle_event/dm_test_notify** → Task 11
- **§三 world_status 修改** → Task 10 (handleWorldStatus)
- **§三 move_to 修改** → Task 10 (handleMoveTo)
- **§四 计时机制** → Task 10 (activity timer, remind timer, milestone, crash recovery)
- **§五 结束条件** → Task 10 (endActivity, all paths)
- **§五 DM 收尾 Prompt** → Task 10 (requestDMEndWrapUp)
- **§六 DM 交互** → Task 9 (applyDMResponse), Task 10 (handleDoActivity planning request)
- **§七 定时 Tick** → Task 10 (tick skip during activity, scheduleTickTimer, midnightRoutine)
- **§八 代码变更清单** → All tasks
- **§十一 Edge Cases** → Task 10 (crash recovery, pending timeout, interlude timeout, move_to, inflight lock, interlude sorting)

---

### Task 13: Commit final changes

- [ ] **Step 1: Final commit**

```bash
git add -A
git commit -m "feat: Activity system — replace Events with time-duration activities, interludes, DM planning"
```

- [ ] **Step 2: Run build one final time**

Run: `npm run build`
Expected: Clean, zero errors.
