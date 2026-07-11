import type {
  WorldState, ScheduleEntry, RouteResult, NPCState,
  Position, RulesData, TickContext, EventsData, NPCsData,
} from "./types.js";
import { readWorld, writeWorld, appendTrajectory, createEmptyWorld } from "./world-state.js";
import { findRoute, advanceTraveling } from "./map-engine.js";
import { findCurrentSegment, findNextSegment, expandSchedule, getDayType } from "./schedule-engine.js";
import { computeNPCStates } from "./npc-engine.js";
import { loadLocations, loadRoadNetwork, loadNPCs, loadEvents, loadRules, loadScheduleTemplate, loadWeather } from "./data-loader.js";
import { createLLMClient, type LLMClient, type DMSession, type DMResponse } from "./llm-client.js";
import { createLogger, type Logger } from "./logger.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

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

事件原则：${rules.event_selection}

移动策略：${rules.movement_policy}

连贯性要求：${rules.continuity}

当前日期：${state.date}（${state.day_type}）
当日天气：${state._dm.weather}

===== NPC 人物介绍 =====

${npcIntro || "（暂无 NPC 数据）"}

===== 输出格式 =====

严格返回 JSON 对象，包含以下字段：
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
如果决定移动，给出理由。大部分日子不改日程。

当写 NPC 偶遇叙事时，参考上方的 NPC 人物介绍，让对话和行为符合人设。`;
}

function buildDMTickPrompt(state: WorldState, ctx: TickContext, events?: EventsData): string {
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

  if (events) {
    const locName = pos.type === "location" ? pos.name : pos.to;
    const locEvents = events[locName];
    if (locEvents && locEvents.length > 0) {
      prompt += `\n\n当前位置（${locName}）可能发生的事件：\n${locEvents.map(e => `- ${e.name}（${e.type}, 稀有度: ${e.rarity}）：${e.description}`).join("\n")}`;
    }
  }

  return prompt;
}

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

const TICK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

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

  // 只有显著缺口（>15min）才记录恢复轨迹，短间隙是正常重启
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

export function startDMScheduler(
  api: OpenClawPluginApi,
  dataDir: string,
): { stop: () => void; handleObserve: () => Promise<string>; handleMoveTo: (location: string, reason?: string) => Promise<string> } {
  const log: Logger = createLogger(dataDir, api.logger);
  log.info("DM scheduler starting", { dataDir });

  const llmClient = createLLMClient();
  const locations = loadLocations();
  const network = loadRoadNetwork();
  const npcs = loadNPCs();
  const rules = loadRules();
  const events = loadEvents();
  const weather = loadWeather();

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

  async function morningRoutine(): Promise<void> {
    const date = getDate();
    const dayType = getDayType(date);

    log.info(`Morning routine: ${date} (${dayType})`);

    // 读或创建 world.json
    let state: WorldState;
    try {
      state = readWorld(dataDir);
    } catch {
      state = createEmptyWorld(date, dayType);
    }

    state.date = date;
    state.day_type = dayType;

    // 天气
    state._dm.weather = pickWeather();

    // 展开日程
    const scheduleTemplate = loadScheduleTemplate();
    state._dm.schedule = expandSchedule(scheduleTemplate, date);

    // 创建 DM session
    if (dmSession) dmSession.close();
    const sysPrompt = buildDMSystemPrompt(rules, state, npcs);
    dmSession = llmClient.dmChat(sysPrompt);

    // 晨间 tick
    const ctx = buildTickContext(state, "07:00", locations, network, npcs);
    const prompt = buildDMTickPrompt(state, ctx, events);
    const response = await dmSession.send(prompt);
    log.info(`DM morning → ${response.environment || "(无环境描述)"}`);

    applyDMResponse(state, response, "07:00");
    state.last_tick = "07:00";
    writeWorld(dataDir, state);

    log.info(`Morning routine complete. Weather: ${state._dm.weather}, Schedule: ${state._dm.schedule.length} segments`);
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
      log.warn("No world.json found, skipping tick");
      return;
    }

    // 推进 traveling
    if (state._mutsumi.position.type === "traveling") {
      // 计算路线总距离
      const route = state._mutsumi.position.route;
      let totalDist = 0;
      const nodeMap = new Map(network.nodes.map(n => [n.id, n.coord]));
      for (let i = 1; i < route.length; i++) {
        const fromCoord = nodeMap.get(route[i - 1])!;
        const toCoord = nodeMap.get(route[i])!;
        totalDist += Math.sqrt((toCoord.x - fromCoord.x) ** 2 + (toCoord.y - fromCoord.y) ** 2);
      }

      const { progress, arrived } = advanceTraveling(
        state._mutsumi.position,
        TICK_INTERVAL_MS,
        1.2,
        totalDist,
      );

      state._mutsumi.position.progress = progress;
      if (arrived) {
        log.info(`Arrived at ${state._mutsumi.position.to}`);
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
      const prompt = buildDMTickPrompt(state, ctx, events);
      const response = await dmSession.send(prompt);
      log.info(`Tick ${time} → ${response.environment || "(无声)"}${response.event ? ` [事件: ${response.event.name}]` : ""}`);
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

  // 启动时恢复或初始化世界
  (async () => {
    let state = await recoverFromCrash(dataDir, locations, network, npcs);
    if (!state) {
      // 没有 world.json（首次启动或非晨间时间）→ 创建初始世界，位置默认"家"
      const date = getDate();
      const dayType = getDayType(date);
      state = createEmptyWorld(date, dayType);
      state._dm.weather = pickWeather();
      state._dm.schedule = expandSchedule(loadScheduleTemplate(), date);
      writeWorld(dataDir, state);
      log.info(`World initialized: ${date} (${dayType}), weather: ${state._dm.weather}, at home`);
    } else {
      log.info(`Recovered from crash. Last tick was ${state.last_tick}`);
    }
  })();

  scheduleMorning();
  timer = setInterval(tick, TICK_INTERVAL_MS);

  function pickWeather(): string {
    const month = new Date().getMonth() + 1; // 1-12
    for (const [_season, config] of Object.entries(weather)) {
      if (config.months.includes(month)) {
        const totalWeight = config.pool.reduce((sum, w) => sum + w.weight, 0);
        let r = Math.random() * totalWeight;
        for (const option of config.pool) {
          r -= option.weight;
          if (r <= 0) return option.type;
        }
        return config.pool[0].type;
      }
    }
    return "晴"; // fallback
  }

  return {
    stop() {
      log.info("DM scheduler stopping");
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
        const prompt = buildDMTickPrompt(state, ctx, events) + "\n（睦子米刚才观察了周围）";
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time);
        state.last_tick = time;
        writeWorld(dataDir, state);
        log.info(`睦子米观察周围 → ${state._dm.environment}`);
        return state._dm.environment;
      }
      return state._dm.environment;
    },
    async handleMoveTo(location: string, reason?: string): Promise<string> {
      log.info(`睦子米主动移动到 ${location}${reason ? ` (${reason})` : ""}`);
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
        const prompt = buildDMTickPrompt(state, ctx, events) + "\n（睦子米主动出发去" + location + "）";
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time);
      }

      state.last_tick = time;
      writeWorld(dataDir, state);

      return `出发去${location}。${state._dm.environment || ""}`;
    },
  };
}
