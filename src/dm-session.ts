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
import { saveDMSession, loadDMSession } from "./dm-store.js";
import { appendDiaryEntry } from "./diary.js";
import { buildEventLookup, mergeEvent } from "./event-utils.js";
import type { EventDef } from "./types.js";
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

function buildDMTickPrompt(state: WorldState, ctx: TickContext, events?: EventsData, recentChat?: string): string {
  const pos = state._mutsumi.position;
  const posDesc = pos.type === "location"
    ? `目前在 ${pos.name}`
    : `正在从 ${pos.from} 去 ${pos.to} 的路上（进度 ${Math.round(pos.progress * 100)}%）`;

  let prompt = `当前时间：${ctx.time}
${posDesc}

今日轨迹：
${state._mutsumi.trajectory.map(t => `- ${t.time} ${t.note}`).join("\n")}

活跃事件：
${state._dm.active_events.map(e => {
    let timeInfo = `${e.created_at} 开始`;
    if (e.handled_at) timeInfo += `，${e.handled_at} 开始处理`;
    return `- ${e.name} [id: ${e.id}]（${e.status}，位置：${e.location}，${timeInfo}）${e.description ? ` — ${e.description}` : ""}`;
  }).join("\n") || "无"}
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

  if (events && pos.type === "location") {
    const locEvents = events[pos.name];
    if (locEvents && locEvents.length > 0) {
      prompt += `\n\n当前位置（${pos.name}）可能发生的事件：\n${locEvents.map(e => `- ${e.name} [id: ${e.id}]（${e.type}, 稀有度: ${e.rarity}）：${e.description}`).join("\n")}`;
    }
  }

  if (recentChat) {
    prompt += `\n\n===== 群聊参考（不要编进环境叙事） =====
睦子米的世界状态检查附带了群聊上下文，仅供你了解她最近参与了什么话题。这些是外部信息，不是你导演的世界的一部分——不要在 environment 里描述群聊内容，也不要替群友编造新消息。
${recentChat}`;
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

const QQ_SESSION_KEY = "agent:main:main";
const QQ_GROUP_ID = "5B07AA16B5A5253C5B89E0021CF0CF15";

/** 通过 scheduleSessionTurn API 通知睦子米（deliveryMode=none，bot 只调工具不说话）。 */
function notifyMutsumi(api: OpenClawPluginApi, message: string, log: Logger): void {
  const fullMessage = `[DM 世界通知]\n${message}\n\n（系统通知，无需回复。如需行动直接使用工具。）`;
  try {
    const result = api.session.workflow.scheduleSessionTurn({
      sessionKey: QQ_SESSION_KEY,
      message: fullMessage,
      delayMs: 2000,
      deliveryMode: "none",
    });
    // 同步部分可能已经返回 undefined，先记一条
    log.info(`DM notify → scheduleSessionTurn called (result pending)`);
    // 异步等结果看是成功还是被 guard 吞了
    result.then((job) => {
      log.info(`DM notify result: ${job ? `job=${job.id}` : "UNDEFINED (被 guard 拦截)"}`);
    }).catch((err) => {
      log.warn(`DM notify result error: ${String(err)}`);
    });
  } catch (err) {
    log.warn(`DM notify failed: ${String(err)}`);
  }
}

function applyDMResponse(
  state: WorldState,
  response: DMResponse,
  time: string,
  eventLookup: Map<string, EventDef>,
): void {
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

  // 叙事笔记（无论是否有事件都记入轨迹，但 prompt 要求 event 不为 null 才填）
  if (response.event_note) {
    appendTrajectory(state, { time, note: response.event_note });
  }

  // 处理事件：合并预定义数据，统一为完整 GameEvent
  if (response.event) {
    const merged = mergeEvent(response.event, eventLookup);
    merged.created_at = time;
    const existing = state._dm.active_events.find(e => e.id === merged.id);
    if (existing) {
      // DM 更新了已有事件（补充描述、推进状态等）→ 合并
      Object.assign(existing, merged);
    } else {
      state._dm.active_events.push(merged);
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

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * 将 DM session 的完整历史保存到本地文件。
 * 使用日期作为文件名，同一天多次保存自动覆盖。
 */
function saveDMSessionState(
  dataDir: string,
  date: string,
  session: DMSession,
  log: Logger,
): void {
  try {
    const history = session.getHistory();
    saveDMSession(dataDir, date, history);
    log.debug(`DM session saved: ${date} (${history.length} messages)`);
  } catch (err) {
    log.warn(`Failed to save DM session: ${String(err)}`);
  }
}

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
  let gapMs = ((nowH * 60 + nowM) - (lastH * 60 + lastM)) * 60 * 1000;
  if (gapMs < 0) gapMs += 24 * 60 * 60 * 1000; // 跨午夜
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
  workspaceDir: string,
): { stop: () => void; handleMoveTo: (location: string, reason?: string) => Promise<string>; handleEvent: (eventId: string, action?: string) => Promise<string>; handleWorldStatus: (recentChat?: string) => Promise<string>; handleWriteDiary: (text: string) => Promise<string>; handleTestNotify: () => string } {
  const log: Logger = createLogger(dataDir, api.logger);
  log.info("DM scheduler starting", { dataDir });

  const llmClient = createLLMClient();
  const locations = loadLocations();
  const network = loadRoadNetwork();
  const npcs = loadNPCs();
  const rules = loadRules();
  const events = loadEvents();
  const eventLookup = buildEventLookup(events);
  const weather = loadWeather();

  let dmSession: DMSession | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let midnightTimer: ReturnType<typeof setTimeout> | null = null;
  let diaryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDMTickTime: string | null = null;
  const DM_TICK_COOLDOWN_MINUTES = 5;

  function getMinutesSinceLastDMTick(currentTime: string): number {
    if (!lastDMTickTime) return Infinity;
    const [lh, lm] = lastDMTickTime.split(":").map(Number);
    const [ch, cm] = currentTime.split(":").map(Number);
    let gap = ch * 60 + cm - (lh * 60 + lm);
    if (gap < 0) gap += 24 * 60;
    return gap;
  }

  function markDMTick(time: string): void {
    lastDMTickTime = time;
  }

  function getTime(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  function getDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  /** 每日 00:00 例行：数据切换 + DM session 初始化 */
  async function midnightRoutine(): Promise<void> {
    const date = getDate();
    const dayType = getDayType(date);

    log.info(`Midnight routine: ${date} (${dayType})`);

    let state: WorldState;
    let isNew = false;
    try {
      state = readWorld(dataDir);
    } catch {
      // 世界不存在 → 首次启动，创建
      state = createEmptyWorld(date, dayType);
      isNew = true;
    }

    if (!isNew && state.date === date) return; // 今天已经更新过

    state.date = date;
    state.day_type = dayType;
    state._dm.weather = pickWeather();

    const scheduleTemplate = loadScheduleTemplate();
    state._dm.schedule = expandSchedule(scheduleTemplate, date);

    // 新的一天，清空轨迹
    state._mutsumi.trajectory = [];

    // 创建新的 DM session + 初始 tick
    if (dmSession) dmSession.close();
    const sysPrompt = buildDMSystemPrompt(rules, state, npcs);
    dmSession = llmClient.dmChat(sysPrompt);

    const time = getTime();
    const ctx = buildTickContext(state, time, locations, network, npcs);
    const prompt = `（系统：新的一天开始了。）\n\n${buildDMTickPrompt(state, ctx, events)}`;
    const response = await dmSession.send(prompt);
    log.info(`DM midnight → ${response.environment || "(无环境描述)"}${response.notify_mutsumi ? " [🔔 notify]" : " [🔇 silent]"}`);

    applyDMResponse(state, response, time, eventLookup);
    if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
    state.last_tick = time;
    writeWorld(dataDir, state);
    saveDMSessionState(dataDir, date, dmSession, log);
    log.info(`Midnight complete. Weather: ${state._dm.weather}, Schedule: ${state._dm.schedule.length} segments`);
  }

  /** 推进 traveling 位置——每次读 world 后调用，确保位置随时间更新。 */
  function advanceTravelingIfNeeded(state: WorldState): void {
    if (state._mutsumi.position.type !== "traveling") return;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = state._mutsumi.position.started_at.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    let gapMs = (nowMinutes - startMinutes) * 60 * 1000;
    if (gapMs < 0) gapMs += 24 * 60 * 60 * 1000; // 跨午夜
    if (gapMs <= 0) return;

    const route = state._mutsumi.position.route;
    let totalDist = 0;
    const nodeMap = new Map(network.nodes.map(n => [n.id, n.coord]));
    for (let i = 1; i < route.length; i++) {
      const fromCoord = nodeMap.get(route[i - 1])!;
      const toCoord = nodeMap.get(route[i])!;
      totalDist += Math.sqrt((toCoord.x - fromCoord.x) ** 2 + (toCoord.y - fromCoord.y) ** 2);
    }

    const { progress, arrived } = advanceTraveling(
      state._mutsumi.position, gapMs, 1.2, totalDist,
    );

    state._mutsumi.position.progress = progress;
    if (arrived) {
      const time = getTime();
      log.info(`Arrived at ${state._mutsumi.position.to}`);
      appendTrajectory(state, { time, note: `到达${state._mutsumi.position.to}` });
      state._mutsumi.position = { type: "location", name: state._mutsumi.position.to };
    }
  }

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

    // 夜间：有 traveling 或活跃事件才 tick，纯睡觉跳过
    if (hour < 7 || hour >= 23) {
      const hasActivity = state._mutsumi.position.type === "traveling"
        || state._dm.active_events.length > 0;
      if (!hasActivity) {
        state.last_tick = time;
        writeWorld(dataDir, state);
        return;
      }
    }

    const ctx = buildTickContext(state, time, locations, network, npcs);

    if (dmSession) {
      const prompt = `（系统定时推进世界。这轮 tick 是自主发起的——如有值得通知睦子米的事，使用 notify_mutsumi。）\n\n${buildDMTickPrompt(state, ctx, events)}`;
      const response = await dmSession.send(prompt);
      log.info(`Tick ${time} → ${response.environment || "(无声)"}${response.event ? ` [事件: ${response.event.name}]` : ""}${response.notify_mutsumi ? ` [🔔 notify]` : " [🔇 silent]"}`);
      applyDMResponse(state, response, time, eventLookup);
      if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
      saveDMSessionState(dataDir, state.date, dmSession, log);
    }

    state.last_tick = time;
    markDMTick(time);
    writeWorld(dataDir, state);
  }

  // 每日 00:00 午夜 routine
  function scheduleMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    midnight.setDate(midnight.getDate() + 1);
    const delay = midnight.getTime() - now.getTime();
    midnightTimer = setTimeout(() => {
      midnightRoutine().then(() => scheduleMidnight());
    }, delay);
  }

  // 启动时恢复或初始化世界
  (async () => {
    let state = await recoverFromCrash(dataDir, locations, network, npcs);
    if (!state) {
      // 没有 world.json → 初始化世界
      await midnightRoutine();
    } else {
      log.info(`Recovered from crash. Last tick was ${state.last_tick}`);

      if (state.date === getDate()) {
        // 当天：恢复 DM session（替换旧的 system prompt 以应用最新指引）
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
      } else {
        // 跨天了：直接跑午夜 routine
        await midnightRoutine();
      }
    }
  })();

  scheduleMidnight();
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
      if (midnightTimer) clearTimeout(midnightTimer);
      if (diaryTimer) clearTimeout(diaryTimer);
      if (dmSession) dmSession.close();
    },
    async handleMoveTo(location: string, reason?: string): Promise<string> {
      // 由 tools.ts 调用
      const state = readWorld(dataDir);
      const wasTraveling = state._mutsumi.position.type === "traveling";
      advanceTravelingIfNeeded(state);
      const arrived = wasTraveling && state._mutsumi.position.type === "location";
      const time = getTime();

      // 如果上段 traveling 刚到达，强制触发到达场景 DM tick
      if (arrived && dmSession) {
        const ctx = buildTickContext(state, time, locations, network, npcs);
        const prompt = buildDMTickPrompt(state, ctx, events) + "\n（睦子米刚到目的地，请描述到达时的场景。）";
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time, eventLookup);
        if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
        markDMTick(time);
        log.info(`Arrival DM tick at ${state._mutsumi.position.type === "location" ? (state._mutsumi.position as {type:"location";name:string}).name : "?"} → ${response.environment || "(无)"}${response.notify_mutsumi ? " [🔔 notify]" : " [🔇 silent]"}`);
      }

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

      // 出发场景 DM tick（强制）
      if (dmSession) {
        const prompt = `当前时间：${time}。睦子米刚从${currentLoc}出发去${location}${reason ? `（${reason}）` : ""}。请描述她动身离开${currentLoc}时的场景。不要描述目的地——她还没到。`;
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time, eventLookup);
        if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
        saveDMSessionState(dataDir, state.date, dmSession, log);
        markDMTick(time);
      }

      state.last_tick = time;
      writeWorld(dataDir, state);

      const minutes = Math.round(route.estimatedMinutes);

      // 预定到达时自动触发 tick（不等 10 分钟定时器）
      const estimatedMs = Math.round(route.estimatedMinutes * 60 * 1000);
      if (estimatedMs > 0 && estimatedMs < 60 * 60 * 1000) { // sanity: < 1 hour
        const targetLocation = location;
        setTimeout(async () => {
          try {
            let s: WorldState;
            try { s = readWorld(dataDir); } catch { return; }
            // 检查是否还在 traveling 同一段路（没被覆盖）
            if (s._mutsumi.position.type !== "traveling" || s._mutsumi.position.to !== targetLocation) return;
            advanceTravelingIfNeeded(s);
            const t = getTime();
            const pos = s._mutsumi.position as unknown as { type: string; name: string };
            if (pos.type === "location" && dmSession) {
              const ctx = buildTickContext(s, t, locations, network, npcs);
              const prompt = buildDMTickPrompt(s, ctx, events) + "\n（睦子米到达了目的地，请描述到达时的场景。）";
              const resp = await dmSession.send(prompt);
              applyDMResponse(s, resp, t, eventLookup);
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
    async handleEvent(eventId: string, action?: string): Promise<string> {
      const state = readWorld(dataDir);
      advanceTravelingIfNeeded(state);
      const time = getTime();

      const event = state._dm.active_events.find(e => e.id === eventId);
      if (!event) {
        const resolved = state._mutsumi.trajectory.some(
          t => t.note === `事件结束：${eventId}`
        );
        if (resolved) return `事件「${eventId}」已经结束了。`;
        return `事件 ${eventId} 不存在或已结束。`;
      }

      const alreadyHandling = event.status === "处理中";

      if (!alreadyHandling) {
        // 首次处理：标记状态，记轨迹
        event.status = "处理中";
        event.handled_at = time;
        const note = action
          ? `开始处理事件「${event.name}」：${action}`
          : `开始处理事件「${event.name}」`;
        appendTrajectory(state, { time, note });
      }

      // 通知 DM，并处理 DM 的响应（可能含环境更新或收束决定）
      let dmNarrative = "";
      if (dmSession) {
        const dmPrompt = alreadyHandling
          ? `（睦子米继续处理事件「${event.name}」${action ? `：${action}` : ""}。）`
          : `（睦子米开始处理事件「${event.name}」${action ? `：${action}` : ""}。先描述场景和NPC反应，不要立刻收束此事件。）`;
        const response = await dmSession.send(dmPrompt);
        applyDMResponse(state, response, time, eventLookup);
        if (response.notify_mutsumi) notifyMutsumi(api, response.notify_mutsumi, log);
        saveDMSessionState(dataDir, state.date, dmSession, log);
        dmNarrative = response.environment ? ` — ${response.environment}` : "";
      }

      // 检测事件是否在本次调用中被 DM 收束
      const wasResolved = !state._dm.active_events.find(e => e.id === eventId);

      state.last_tick = time;
      writeWorld(dataDir, state);

      const prefix = alreadyHandling ? `继续处理「${event.name}」` : `处理「${event.name}」`;
      return `${prefix}${dmNarrative}${wasResolved ? "（事件已结束）" : ""}`;
    },
    async handleWorldStatus(recentChat?: string): Promise<string> {
      const state = readWorld(dataDir);
      advanceTravelingIfNeeded(state);
      const time = getTime();

      // DM tick 仅在冷却时间外触发（连续观察不会反复扰动世界）
      const shouldTick = getMinutesSinceLastDMTick(time) >= DM_TICK_COOLDOWN_MINUTES;
      if (dmSession && shouldTick) {
        const ctx = buildTickContext(state, time, locations, network, npcs);
        const prompt = `（睦子米查看了世界状态——她主动发起的，不需要 notify_mutsumi。）\n\n${buildDMTickPrompt(state, ctx, events, recentChat)}`;
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, time, eventLookup);
        // world_status 不 notify（睦子米主动查的，她已经知道结果了）
        saveDMSessionState(dataDir, state.date, dmSession, log);
        markDMTick(time);
        log.info(`world_status DM tick → ${response.environment || "(无声)"} [🔇 skip notify]`);
      }

      state.last_tick = time;
      writeWorld(dataDir, state);

      // 构建状态字符串
      const pos = state._mutsumi.position;
      const posDesc = pos.type === "location"
        ? pos.name
        : `正在从${pos.from}去${pos.to}的路上`;

      const trajSummary = state._mutsumi.trajectory.length > 0
        ? state._mutsumi.trajectory.map(t => `${t.time} ${t.note}`).join("；")
        : "今天还没有记录。";

      const eventsSummary = state._dm.active_events.length > 0
        ? state._dm.active_events.map(e => `${e.name}(id:${e.id}) — ${e.description}`).join("、")
        : "";

      const now = new Date();
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

      // 下一段日程
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
        `\n今天：${trajSummary}` +
        (eventsSummary ? `\n活跃事件：${eventsSummary}` : "")
      );
    },
    async handleWriteDiary(text: string): Promise<string> {
      await appendDiaryEntry(dataDir, workspaceDir, text);
      return "记下了。";
    },
    // 临时测试工具：手动触发 DM 通知
    handleTestNotify(): string {
      notifyMutsumi(api, "这是一条测试通知。收到后用 write_diary 工具写一条日记：「今天收到了DM的测试通知，系统运转正常。」", log);
      return "测试通知已发送。";
    },
  };
}
