# 开发进度

## 如何更新本文档

每次开发 session 结束后，在对应的章节追加或修改内容。普通改动直接写。如果完成了某个功能或修复了某个 bug，标 ✅ 并移到「已完成」章节。如果遇到新障碍，加到「阻碍」章节。保持简洁——每行一句话。

**格式约定**：
- 进行中的功能：`- [ ] 描述（开始日期）`
- 已完成：`- [x] 描述（完成日期）`
- Bug：`- [ ] BUG: 描述`
- 阻碍：`- [ ] BLOCKED: 描述 — 原因`

---

## 已完成

- [x] 世界模拟引擎（地图/日程/NPC/事件/LLM 客户端/DM 会话）（2026-07-11）
- [x] 6 个基础工具：world_status / check_schedule / observe_surroundings / move_to / handle_event / write_diary（2026-07-11）
- [x] 日记生成（23:30 自动 + write_diary 手动）（2026-07-11）
- [x] DM session 持久化到 dm-sessions/ 目录（2026-07-11）
- [x] 日志时间戳改为本地时间（2026-07-11）
- [x] observe 返回完整事件信息（含 id + description）（2026-07-11）
- [x] event_note 始终记入轨迹（2026-07-11）
- [x] 事件系统重构：ActiveEvent → GameEvent 统一类型，DM 自定义事件与预定义事件同权（2026-07-12）
- [x] event-utils.ts：buildEventLookup（O(1) 查找）、mergeEvent（预定义+DM 合并）（2026-07-12）
- [x] observe_surroundings 不再扫描 events.json，直接用 GameEvent 自带字段（2026-07-12）
- [x] 事件生命周期：未处理 → 处理中 → DM 收束（2026-07-12）
- [x] handle_event 标记 status="处理中" 而非删除，DM 负责正式收束（2026-07-12）
- [x] GameEvent 加 created_at / handled_at 时间戳（2026-07-12）
- [x] DM tick prompt 按状态显示事件时间线（2026-07-12）
- [x] world_status 先触发 DM tick 再返回（2026-07-12）
- [x] DM prompt 翻转：resolve_event_id 从禁止变为鼓励（在合适时机收束）（2026-07-12）
- [x] 午夜 routine 替代晨间 routine：00:00 统一处理日期/天气/日程/DM session（2026-07-12）
- [x] 日程覆盖 00:00-00:00（24h），00:00-07:00 标记为睡眠（2026-07-12）
- [x] getDate 改用本地时间（修复 UTC+8 凌晨拿到前一天日期）（2026-07-12）
- [x] handle_event 返回值带 DM 环境叙事，bot 能感知 NPC 反馈（2026-07-12）
- [x] applyDMResponse 同 id 事件更新而非跳过（DM 补充描述不丢失）（2026-07-12）
- [x] traveling 推进抽成共享函数 advanceTravelingIfNeeded，所有 handler 调用（2026-07-12）
- [x] 跨午夜时间差修复（recoverFromCrash + advanceTravelingIfNeeded）（2026-07-12）
- [x] DM prompt 强化：禁止在收到处理消息后立即收束事件（2026-07-12）
- [x] SOUL.md 事件交互规则：多轮互动，不做单次处理（2026-07-12）
- [x] 22 个测试全过（2026-07-12）

## 进行中

_目前无进行中的功能。_

## Bug

- [x] BUG: active_events 重复 — 已修复 2026-07-11
- [x] BUG: 日志时间 UTC 差 8 小时 — 已修复 2026-07-11
- [x] BUG: 中午重启后 dmSession=null — 已修复 2026-07-11
- [x] BUG: move_to 后睦子米以为到了目的地 — 已修复 2026-07-11
- [x] BUG: traveling 时 DM 描述目的地场景 — 已修复 2026-07-11
- [x] BUG: event_note 在 event:null 时被丢弃 — 已修复 2026-07-11
- [x] BUG: getDate 用 UTC 导致凌晨日期错误 — 已修复 2026-07-12
- [x] BUG: 夜间 traveling 不推进（tick 只在 07-23 运行）— 已修复 2026-07-12
- [x] BUG: handle_event 后 DM 叙事被吞（返回值无反馈）— 已修复 2026-07-12
- [x] BUG: DM 在 handle_event 同一轮立即收束事件 — prompt 已强化 2026-07-12
- [x] BUG: recoverFromCrash 跨午夜时间差为负 — 已修复 2026-07-12

## 阻碍

_目前无阻碍。_

## 未验证的改动

以下改动代码已写好、编译通过、测试通过，但还没有在实际 bot 对话中验证效果：

- [ ] handle_event 多轮交互：bot 是否会在得到 DM 反馈后自然地继续对话（而非处理一次就停）
- [ ] DM 是否真的不会在收到 handle_event 后立即收束（prompt 已强化"至少等一个 tick 周期"）
- [ ] 午夜 routine 跨天后 DM session 是否正确创建、首条 tick 是否正常
- [ ] 凌晨 move_to → observe 往返：traveling 是否正常推进、到达后位置是否正确切换
