// src/tools.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { readWorld } from "./world-state.js";
import { findCurrentSegment } from "./schedule-engine.js";
import type { WorldState } from "./types.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
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
