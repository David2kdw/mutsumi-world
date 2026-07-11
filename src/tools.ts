// src/tools.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { readWorld } from "./world-state.js";
import { findCurrentSegment } from "./schedule-engine.js";
import type { WorldState } from "./types.js";
import type { Logger } from "./logger.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

export function registerTools(
  api: OpenClawPluginApi,
  scheduler: ReturnType<typeof import("./dm-session.js").startDMScheduler>,
  dataDir: string,
  log: Logger,
): void {
  // ====== world_status ======
  api.registerTool({
    name: "world_status",
    label: "查看世界状态",
    description: "查看当前时间、位置、天气、今天发生了什么。当群友问「今天怎么样」「在哪」「做了什么」时先调用。",
    parameters: { type: "object", properties: {} },
    async execute() {
      log.info("睦子米使用 world_status");
      try {
        // 先触发 DM tick 刷新世界，再返回状态
        const result = await scheduler.handleWorldStatus();
        log.info(`睦子米 world_status → ${result}`);
        return textResult(result);
      } catch {
        return textResult("世界尚未启动。");
      }
    },
  });

  // ====== check_schedule ======
  api.registerTool({
    name: "check_schedule",
    label: "查看日程",
    description: "查看今天的课表或行程安排。当群友问「今天有什么课」「接下来去哪」时调用。",
    parameters: { type: "object", properties: {} },
    async execute() {
      log.info("睦子米使用 check_schedule");
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

      const result = text || "今天的日程结束了。";
      log.info(`睦子米 check_schedule → ${result}`);
      return textResult(result);
    },
  });

  // ====== observe_surroundings ======
  api.registerTool({
    name: "observe_surroundings",
    label: "观察周围",
    description: "仔细观察周围的环境——看到了什么、听到了什么、闻到了什么。当群友问「周围有什么」「在干嘛」时调用。",
    parameters: { type: "object", properties: {} },
    async execute() {
      log.info("睦子米观察周围");
      try {
        const env = await scheduler.handleObserve();
        const state = readWorld(dataDir);
        // 活跃事件自带完整数据，不需要扫描 events.json
        const events = state._dm.active_events
          .map(e => {
            const hint = e.resolve_hint ? ` [提示: ${e.resolve_hint}]` : "";
            return `【${e.name}】(id: ${e.id}) ${e.location} | ${e.status} — ${e.description}${hint}`;
          })
          .join("；");
        const full = env + (events ? `\n附近的事件：${events}` : "");
        log.info(`睦子米观察周围 → ${full}`);
        return textResult(full);
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
      log.info(`睦子米移动到 ${p.location}${p.reason ? `（${p.reason}）` : ""}`);
      try {
        const result = await scheduler.handleMoveTo(p.location, p.reason);
        log.info(`睦子米 move_to → ${result}`);
        return textResult(result);
      } catch (err) {
        return textResult(`没法去${p.location}。${err instanceof Error ? err.message : ""}`);
      }
    },
  });

  // ====== handle_event ======
  api.registerTool({
    name: "handle_event",
    label: "处理事件",
    description: "主动处理或回应一个事件——读纸条、回复消息、捡东西、回应NPC等。当睦子米想对某个活跃事件做出反应时调用。",
    parameters: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "事件ID（从 observe_surroundings 或 world_status 中获取）",
        },
        action: {
          type: "string",
          description: "你怎么处理这个事件（可选）",
        },
      },
      required: ["event_id"],
    },
    async execute(_toolCallId, params) {
      const p = params as { event_id: string; action?: string };
      log.info(`睦子米处理事件: ${p.event_id}${p.action ? ` — ${p.action}` : ""}`);
      try {
        const result = await scheduler.handleEvent(p.event_id, p.action);
        log.info(`睦子米 handle_event → ${result}`);
        return textResult(result);
      } catch (err) {
        return textResult(`处理事件失败。${err instanceof Error ? err.message : ""}`);
      }
    },
  });

  // ====== write_diary ======
  api.registerTool({
    name: "write_diary",
    label: "写日记",
    description: "现在写今天的日记。如果今天已经写过，会覆盖。当群友说「写日记」「记一下」或者你想记录今天时调用。",
    parameters: { type: "object", properties: {} },
    async execute() {
      log.info("睦子米手动写日记");
      try {
        const result = await scheduler.handleWriteDiary();
        log.info(`睦子米 write_diary → ${result}`);
        return textResult(result);
      } catch (err) {
        return textResult(`写日记失败。${err instanceof Error ? err.message : ""}`);
      }
    },
  });

  api.logger?.info?.("[mutsumi-world] 6 tools registered");
}
