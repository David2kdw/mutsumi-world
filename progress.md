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

### 世界引擎
- [x] 世界模拟引擎（地图/日程/NPC/事件/LLM 客户端/DM 会话）（2026-07-11）
- [x] 5 个工具：world_status / check_schedule / move_to / handle_event / write_diary（2026-07-12 合并 observe_surroundings）
- [x] 日记生成（23:30 自动 + write_diary 手动）（2026-07-11）
- [x] DM session 持久化到 dm-sessions/ 目录（2026-07-11）
- [x] 日志时间戳改为本地时间（2026-07-11）

### 事件系统
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
- [x] handle_event 返回值带 DM 环境叙事，bot 能感知 NPC 反馈（2026-07-12）
- [x] applyDMResponse 同 id 事件更新而非跳过（DM 补充描述不丢失）（2026-07-12）

### 日程与时间
- [x] 午夜 routine 替代晨间 routine：00:00 统一处理日期/天气/日程/DM session（2026-07-12）
- [x] 日程覆盖 00:00-00:00（24h），00:00-07:00 标记为睡眠（2026-07-12）
- [x] getDate 改用本地时间（修复 UTC+8 凌晨拿到前一天日期）（2026-07-12）
- [x] traveling 推进抽成共享函数 advanceTravelingIfNeeded，所有 handler 调用（2026-07-12）
- [x] 跨午夜时间差修复（recoverFromCrash + advanceTravelingIfNeeded）（2026-07-12）

### DM 行为
- [x] DM prompt 强化：禁止在收到处理消息后立即收束事件（2026-07-12）
- [x] handle_event prompt 与 system prompt 一致：不再鼓励 DM 在同一轮收束（2026-07-12）
- [x] handleEvent 幂等：事件已结束时查 trajectory 确认，返回友好消息（2026-07-12）
- [x] handleEvent 返回值加"（事件已结束）"信号，bot 知道不用重试（2026-07-12）

### 移动系统
- [x] advanceTravelingIfNeeded 时间基准从 last_tick 改为 started_at，防止高频调用时 progress 不推进（2026-07-12）
- [x] handleMoveTo 补 advanceTravelingIfNeeded 调用，与其他 handler 一致（2026-07-12）

### 日记
- [x] diary.ts 移除 trajectory 清空（write_diary 不再回写空轨迹覆盖数据）（2026-07-12）
- [x] diary.ts 改为 append 模式：手动 write_diary 直接追加，不经 LLM（2026-07-12）
- [x] write_diary 工具加 text 参数，bot 自己写内容传入（2026-07-12）
- [x] 23:30 自动总结保留：读手动日记条目 + 轨迹，LLM 生成回顾后 append（2026-07-12）

### Bot 行为指南
- [x] SOUL.md：移动中只观察一次规则（2026-07-12）
- [x] SOUL.md：群友不是 NPC 边界规则——DM 数据不是群消息，不要把群友当祥子素世（2026-07-12）
- [x] SOUL.md：事件交互通过 handle_event 而非 QQ 群对话（2026-07-12）
- [x] tools.ts：move_to / observe 工具描述加频率提示（2026-07-12）

### 移动系统
- [x] moveTo 到达自动 tick：出发后按路线预估时间设 setTimeout，到点检测到达并触发 DM 场景（2026-07-12）

### DM 行为
- [x] 夜间有条件 tick：23:00-07:00 有 traveling 或活跃事件时照常 tick，纯睡觉跳过（2026-07-12）
- [x] DM tick 冷却：world_status 调用间隔 < 5min 跳过 DM，只读静态状态返回（2026-07-12）
- [x] world_status 返回值加环境描述（2026-07-12）
- [x] Tick 间隔改为 15 分钟（2026-07-12）

### 测试
- [x] 22 个测试全过（2026-07-12）

### DM 通知通道调研
- [x] scheduleSessionTurn 仅 bundled 插件可用，工作区插件 return silently（2026-07-12）
- [x] enqueueNextTurnInjection 无限制但只注入不触发回合（2026-07-12）
- [x] openclaw agent CLI 可触发回合（2026-07-12）
- [x] QQ session key: `agent:main:main`，群 ID: `5B07AA16B5A5253C5B89E0021CF0CF15`（2026-07-12）

### DM → Mutsumi 通知通道
- [x] DM system prompt 加 `notify_mutsumi` 字段 + 通知时机指南（2026-07-12）
- [x] `applyDMResponse` 7 个调用点检测 `response.notify_mutsumi` → spawn `openclaw agent`（不加 `--deliver`，bot 只调工具不说话）（2026-07-12）
- [x] `recent_chat` 参数：`world_status` 工具 → `handleWorldStatus` → `buildDMTickPrompt` → DM 看到群聊上下文（2026-07-12）
- [x] DM session 恢复时替换旧 system prompt 以应用最新指引（2026-07-12）
- [x] E2E 验证：`openclaw agent` 不加 `--deliver` → bot 调了 `write_diary`，QQ 群无消息（2026-07-12）
- [x] recent_chat 全链路验证：DM session 中出现群聊上下文（2026-07-12）
- [x] DM prompt 来源标记：定时 tick/世界推进 鼓励 notify，睦子米主动查 world_status 跳过 notify（2026-07-12）
- [x] 群聊上下文隔离：prompt 明确标注「不要编进环境叙事」，防止 DM 幻觉群聊消息（2026-07-12）
- [x] 生产验证：DM 在 17:07 和 17:22 成功通知，bot 收到后自发给 move_to 家、write_diary、handle_event 热饭（2026-07-12）

### DM 通知通道 Bug 修复
- [x] spawn ENOENT：Scheduled Task 无 PATH → 改用完整路径 `C:\Users\...\npm\openclaw.cmd`（2026-07-12）
- [x] spawn EINVAL：`--message` 含特殊字符 → 改用 `--message-file` 临时文件（2026-07-12）
- [x] 终端窗口不关闭：`shell: true` → `cmd.exe /c`，执行完自动关窗（2026-07-12）
- [x] parseJSONResponse 增强：宽松 markdown fence + regex 提取 `{...}` + 失败返回 `"(DM 输出格式异常)"`（2026-07-12）
- [x] 僵尸进程清理：15 个 node 进程 → 全杀 + 单实例确认（2026-07-12）

### 日志改进
- [x] 所有 DM tick 日志加 `[🔔 notify]` / `[🔇 silent]` / `[🔇 skip notify]` 标记（2026-07-12）

### 群 session 管理
- [x] QQ 群 session 重置方法：删 trajectory 文件 + sessions.json 记录（2026-07-12）

## 进行中

_无进行中项目。_

## 下一任接手第一句话

通知通道已经完整实现并生产验证。DM 自主决定 notify_mutsumi，代码 spawn `cmd.exe /c openclaw agent --message-file` 推送（不加 --deliver）。DM 能看到 `[🔔 notify]` 日志，bot 收到后自发改工具不吭声。群 session key: agent:main:qqbot:group:5b07aa16…，reset: 删 sessions/ UUID 文件 + sessions.json。潜在问题：notify spawn 后 gateway 偶尔 crash（看日志有 3 次 recoverFromCrash），可能与工具并发调用有关，待排查。

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
- [x] BUG: advanceTravelingIfNeeded 用 last_tick 导致高频调用 progress 不推进 — 已修复 2026-07-12
- [x] BUG: diary.ts 手动写日记后清空 trajectory — 已修复 2026-07-12
- [x] BUG: bot 把群友当 NPC（对着 LLLDDD 说祥子的台词）— SOUL.md 加边界规则 2026-07-12

## 阻碍

_目前无阻碍。_

## 未验证的改动

以下改动代码已写好、编译通过、测试通过，但还没有在实际 bot 对话中验证效果：

- [ ] handle_event 多轮交互：bot 是否会在得到 DM 反馈后自然地继续对话
- [ ] DM 是否真的不会在收到 handle_event 后立即收束
- [ ] 午夜 routine 跨天后 DM session 是否正确创建
- [ ] 凌晨 move_to → observe 往返：traveling 是否正常推进、到达后位置是否正确切换
- [ ] diary append 模式：手动 write_diary 是否正确追加、23:30 总结是否正常生成
- [ ] 群友/NPC 边界：bot 是否不再将群友当成 NPC 回复
