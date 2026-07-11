import { readWorld, writeWorld, appendTrajectory } from "./world-state.js";
import { findRoute } from "./map-engine.js";
import { findCurrentSegment, findNextSegment } from "./schedule-engine.js";
import { computeNPCStates } from "./npc-engine.js";
import { loadLocations, loadRoadNetwork, loadNPCs, loadEvents, loadRules } from "./data-loader.js";
import { createLLMClient } from "./llm-client.js";
function buildDMSystemPrompt(rules, state) {
    return `你是月之森女子学园世界的导演。你的职责是客观描述这个世界的运转。

${rules.tone}

环境描写要求：${rules.environment_style}

事件原则：${rules.event_selection}

移动策略：${rules.movement_policy}

连贯性要求：${rules.continuity}

当前日期：${state.date}（${state.day_type}）
当日天气：${state._dm.weather}

输出格式：严格返回 JSON 对象，包含以下字段：
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
如果决定移动，给出理由。大部分日子不改日程。`;
}
function buildDMTickPrompt(state, ctx) {
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
    return prompt;
}
function buildTickContext(state, time, locations, network, npcs) {
    const currentSegment = findCurrentSegment(state._dm.schedule, time);
    const nextSegment = findNextSegment(state._dm.schedule, time);
    let nextRoute = null;
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
function applyDMResponse(state, response, time) {
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
        state._dm.active_events = state._dm.active_events.filter(e => e.id !== response.resolve_event_id);
        appendTrajectory(state, { time, note: `事件结束：${response.resolve_event_id}` });
    }
}
const TICK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
export function startDMScheduler(api, dataDir) {
    const llmClient = createLLMClient(api);
    const locations = loadLocations();
    const network = loadRoadNetwork();
    const npcs = loadNPCs();
    const rules = loadRules();
    const events = loadEvents();
    let dmSession = null;
    let timer = null;
    let morningTimer = null;
    let diaryTimer = null;
    function getTime() {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    }
    function getDate() {
        return new Date().toISOString().slice(0, 10);
    }
    function getDayTypeForToday() {
        const day = new Date().getDay();
        if (day === 6)
            return "saturday";
        if (day === 0)
            return "sunday";
        return "weekday";
    }
    async function morningRoutine() {
        const date = getDate();
        const dayType = getDayTypeForToday();
        api.logger?.info?.(`[mutsumi-world] Morning routine: ${date} (${dayType})`);
        // 读或创建 world.json
        let state;
        try {
            state = readWorld(dataDir);
        }
        catch {
            state = {
                last_tick: "07:00",
                date,
                day_type: dayType,
                _dm: { weather: "", schedule: [], environment: "", active_events: [] },
                _mutsumi: { position: { type: "location", name: "家" }, trajectory: [] },
            };
        }
        state.date = date;
        state.day_type = dayType;
        // 天气
        state._dm.weather = pickWeather();
        state._dm.schedule = [];
        // 创建 DM session
        if (dmSession)
            dmSession.close();
        const sysPrompt = buildDMSystemPrompt(rules, state);
        dmSession = llmClient.dmChat(sysPrompt);
        // 晨间 tick
        const ctx = buildTickContext(state, "07:00", locations, network, npcs);
        const prompt = buildDMTickPrompt(state, ctx);
        const response = await dmSession.send(prompt);
        applyDMResponse(state, response, "07:00");
        state.last_tick = "07:00";
        writeWorld(dataDir, state);
        api.logger?.info?.(`[mutsumi-world] Morning routine complete. Weather: ${state._dm.weather}`);
    }
    async function tick() {
        const time = getTime();
        const hour = new Date().getHours();
        // 夜间不主动 tick
        if (hour < 7 || hour >= 23)
            return;
        let state;
        try {
            state = readWorld(dataDir);
        }
        catch {
            api.logger?.warn?.("[mutsumi-world] No world.json found, skipping tick");
            return;
        }
        // 推进 traveling
        if (state._mutsumi.position.type === "traveling") {
            const elapsedMs = TICK_INTERVAL_MS; // approx since last tick
            // 精确计算下次再说，先用近似值
            state._mutsumi.position.progress = Math.min(1, state._mutsumi.position.progress + 0.1);
            if (state._mutsumi.position.progress >= 1) {
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
            const prompt = buildDMTickPrompt(state, ctx);
            const response = await dmSession.send(prompt);
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
        if (now > morning)
            morning.setDate(morning.getDate() + 1);
        const delay = morning.getTime() - now.getTime();
        morningTimer = setTimeout(() => {
            morningRoutine().then(() => scheduleMorning());
        }, delay);
    }
    scheduleMorning();
    timer = setInterval(tick, TICK_INTERVAL_MS);
    function pickWeather() {
        // 简化的天气随机——后续可以读 weather.json 做加权
        const pool = ["晴", "晴", "晴", "多云", "多云", "小雨"];
        return pool[Math.floor(Math.random() * pool.length)];
    }
    return {
        stop() {
            if (timer)
                clearInterval(timer);
            if (morningTimer)
                clearTimeout(morningTimer);
            if (diaryTimer)
                clearTimeout(diaryTimer);
            if (dmSession)
                dmSession.close();
        },
        async handleObserve() {
            // 由 tools.ts 调用
            const state = readWorld(dataDir);
            const time = getTime();
            const ctx = buildTickContext(state, time, locations, network, npcs);
            if (dmSession) {
                const prompt = buildDMTickPrompt(state, ctx) + "\n（睦子米刚才观察了周围）";
                const response = await dmSession.send(prompt);
                applyDMResponse(state, response, time);
                state.last_tick = time;
                writeWorld(dataDir, state);
                return state._dm.environment;
            }
            return state._dm.environment;
        },
        async handleMoveTo(location, reason) {
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
                const prompt = buildDMTickPrompt(state, ctx) + "\n（睦子米主动出发去" + location + "）";
                const response = await dmSession.send(prompt);
                applyDMResponse(state, response, time);
            }
            state.last_tick = time;
            writeWorld(dataDir, state);
            return `出发去${location}。${state._dm.environment || ""}`;
        },
    };
}
