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
- [x] 4 个基础工具：world_status / check_schedule / observe_surroundings / move_to（2026-07-11）
- [x] 日记生成（23:30 自动 + write_diary 手动，纯 trajectory 不读 QQ 聊天）（2026-07-11）
- [x] DM session 持久化到 dm-sessions/ 目录（2026-07-11）
- [x] 日志时间戳改为本地时间（2026-07-11）
- [x] 启动时直接跑 morningRoutine，不用手动拼世界/session（2026-07-11）
- [x] move_to 返回值明确说"正在路上"，不描述目的地（2026-07-11）
- [x] traveling 时不显示目的地事件（2026-07-11）
- [x] observe 返回完整事件信息（含 id + description）（2026-07-11）
- [x] 6 个工具全部记返回值日志（2026-07-11）
- [x] DM prompt 中显示 event id（2026-07-11）
- [x] event_note 始终记入轨迹（不再被 event:null 丢弃）（2026-07-11）
- [x] DM prompt 禁止 auto-resolve 事件（2026-07-11）

## 进行中

- [ ] handle_event 工具：让睦子米主动处理事件（2026-07-11）
  - 代码已写好，待测试
  - 依赖 DM 使用正确的 event id（预定义或自定义）
- [ ] SOUL.md 集成所有工具（2026-07-11）
  - 已有 §十三 楚门的世界，可能需要微调

## Bug

- [x] BUG: active_events 重复（applyDMResponse 未去重）— 已修复 2026-07-11
- [x] BUG: 日志时间 UTC 差 8 小时 — 已修复 2026-07-11
- [x] BUG: 中午重启后 dmSession=null，tick 全空转 — 已修复 2026-07-11
- [x] BUG: move_to 后睦子米以为到了目的地 — 已修复（返回值 + SOUL.md）2026-07-11
- [x] BUG: traveling 时 DM 描述目的地场景 — 已修复 2026-07-11
- [x] BUG: event_note 在 event:null 时被丢弃 — 已修复 2026-07-11
- [ ] BUG: DM 有时仍然替睦子米 auto-resolve 事件（设为 null 不设 resolve_event_id）
  - prompt 已改，需要测试验证

## 阻碍

_目前无阻碍。_

## 未提交的改动

- event 机制完善（event id 显示、event_note 保存、禁止 auto-resolve）
- write_diary / handle_event 工具
- 日记去掉 QQ chat log 解析
- dm-sessions/ 子目录
- 多个 dm-session / move_to / observe 优化
