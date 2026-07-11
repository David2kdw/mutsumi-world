# DM → Mutsumi 通知通道 & 聊天上下文注入

## 概述

DM tick 的结果注入 QQ 会话，让睦子米能主动响应世界变化。定时 tick 不再是 DM 代笔写轨迹，而是通过通知让睦子米真正行动。

## 核心机制

```
定时 tick(15min) 或 日程/事件触发
  → DM 叙事
  → DM 觉得值得通知 → notify_mutsumi 字段有值
  → 插件调用 scheduleSessionTurn → bot 醒来
  → 睦子米在 QQ 里说出来，或调 move_to / handle_event
  → 轨迹变成真实行动记录
```

DM 觉得不重要 → silent tick，不通知。新事件、NPC 接近、该出发了 → notify。

## 改动清单

### 1. DM response 加 `notify_mutsumi` 字段

**`dm-session.ts` — `buildDMSystemPrompt`**

DM 输出 JSON 增加可选字段：

```json
{
  "notify_mutsumi": "下节课 10:00 在音乐室，从中庭走过去约 4 分钟。" 
}
```

字段语义：如果 DM 填写（非 null 非空），代码把这段文字通过 `scheduleSessionTurn` 推送给睦子米；如果留 null，silent tick。

prompt 里加指导：什么时候该通知、什么时候安静。

### 2. `applyDMResponse` 调用 `scheduleSessionTurn`

**`dm-session.ts` — `applyDMResponse` + 通知触发**

`applyDMResponse` 末尾检测 `response.notify_mutsumi`，有值则：

```typescript
await api.session.workflow.scheduleSessionTurn({
  sessionKey: qqSessionKey,    // agent:main:qqbot:group:<id>
  message: response.notify_mutsumi,
  delayMs: 500,                // 小延迟，让 tick 先写盘
  deliveryMode: "announce",
  tag: "dm-tick-notification",
});
```

Session key 从 `api.config` 里的 qqbot 配置拼接：`agent:main:qqbot:group:<group_id>`。

### 3. DM prompt 加聊天上下文

**`dm-session.ts` — `buildDMTickPrompt` / `handleWorldStatus`**

`world_status` 工具加可选参数 `recent_chat`（string）。当 bot 调用时传入最近对群友说的话，DM tick prompt 追加：

```
睦子米最近在群里说：
（bot 传入的内容，或"无"）
```

定时 tick 没有聊天上下文时该字段为"无"。SOUL.md 指导 bot 在调用 world_status 时简要附上最近讨论的话题。

### 4. DM 日程移动建议走通知

DM 看到下一段日程该出发了 → `action: "move"` + `notify_mutsumi`。

**代码不自动执行 `action: "move"`**。睦子米收到通知后自行决定是否调 `move_to`。保持 bot 自主权。

### 5. 定时 tick 每次通知（默认）

定时 tick 除了 silent 跳过的情况（夜间无事），每次完成 DM 调用后如果 `notify_mutsumi` 有值就推送。DM 自主决定说还是不说。

### 6. Tick 间隔改为 15 分钟

`TICK_INTERVAL_MS = 15 * 60 * 1000`。

## 数据流

```
┌──────────┐  tick/manual  ┌─────────┐  notify_mutsumi  ┌──────────────┐
│  DM (DS) │◄─────────────│ Plugin  │────────────────►│ OpenClaw     │
│          │──────────────►│         │ scheduleSessionTurn │ Cron/Gateway │
└──────────┘  response     └─────────┘                 └──────┬───────┘
                                                              │
                                                              ▼
                                                     ┌──────────────┐
                                                     │ QQ 群消息     │
                                                     │ 睦子米醒来    │
                                                     └──────────────┘
```

## DM prompt 补充：通知时机指南

```
何时通知睦子米（notify_mutsumi）：
- 睦子米到达目的地了（值得告诉她周围环境）
- 新事件出现了（NPC 靠近、纸条、异常）
- 下一段日程该出发了（提前几分钟提醒路线）
- 事件收束了（告诉她结果）
- 环境发生显著变化（天气突变等）

何时安静（notify_mutsumi 留 null）：
- 睦子米在睡觉且无事发生
- 环境没有变化
- 距离上次通知不到 10 分钟且无新情况
```

## 不变部分

- `advanceTravelingIfNeeded` 仍由所有 handler 和 tick 调用
- `world_status` 冷却 5 分钟不变
- `handleMoveTo` 到达 setTimeout 不变
- 夜间条件 tick 不变
- 工具列表不变（5 个工具）

## 文件变更

| 文件 | 改动 |
|------|------|
| `src/dm-session.ts` | ①prompt 加 notify_mutsumi 指引 ②applyDMResponse 检测 notify 调 scheduleSessionTurn ③handleWorldStatus 收 recent_chat 参数 ④buildDMTickPrompt 加聊天上下文字段 ⑤TICK_INTERVAL_MS = 15 min ⑥startDMScheduler 接收 api 引用 |
| `src/tools.ts` | world_status 加 recent_chat 可选参数 |
| `src/index.ts` | 传 api 进 startDMScheduler |
| `data/rules.json` | 可加 notify 时机规则（或在 prompt 里硬编码） |
