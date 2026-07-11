import { findRoute } from "./map-engine.js";
function timeToMinutes(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
}
/**
 * 找到 NPC 当前时间所在的日程段。
 */
export function findCurrentNPCSchedule(schedule, time) {
    const tMin = timeToMinutes(time);
    // 在第一个段之前
    if (schedule.length === 0 || tMin < timeToMinutes(schedule[0].time)) {
        return null;
    }
    for (let i = 0; i < schedule.length; i++) {
        const entry = schedule[i];
        const entryMin = timeToMinutes(entry.time);
        const nextEntry = schedule[i + 1];
        if (!nextEntry)
            return entry; // 最后一个段
        const nextMin = timeToMinutes(nextEntry.time);
        if (tMin >= entryMin && tMin < nextMin)
            return entry;
    }
    return schedule[schedule.length - 1];
}
/**
 * 计算所有 NPC 在给定时间的状态。
 */
export function computeNPCStates(npcs, dayType, time, locations, network) {
    const states = [];
    for (const [id, def] of Object.entries(npcs)) {
        const daySchedule = def.schedule[dayType] || def.schedule["weekday"] || [];
        const currentEntry = findCurrentNPCSchedule(daySchedule, time);
        if (!currentEntry) {
            // NPC 还没开始今天的行程，放在 from 位置
            const firstEntry = daySchedule[0];
            states.push({
                id,
                display: def.display,
                position: { type: "location", name: firstEntry?.from || "丰川家" },
            });
            continue;
        }
        const entryTimeMin = timeToMinutes(currentEntry.time);
        const currentTimeMin = timeToMinutes(time);
        const elapsedMin = currentTimeMin - entryTimeMin;
        const elapsedMs = elapsedMin * 60 * 1000;
        if (elapsedMin <= 0) {
            // 刚好在这个时间点，还没出发
            states.push({
                id,
                display: def.display,
                position: { type: "location", name: currentEntry.from },
            });
            continue;
        }
        // 计算路线
        const route = findRoute(network, locations, currentEntry.from, currentEntry.to);
        const travelTimeMs = (route.totalDistance / def.speed) * 1000;
        if (elapsedMs >= travelTimeMs) {
            // 已到达
            states.push({
                id,
                display: def.display,
                position: { type: "location", name: currentEntry.to },
            });
        }
        else {
            // 在路上
            const progress = elapsedMs / travelTimeMs;
            states.push({
                id,
                display: def.display,
                position: {
                    type: "traveling",
                    from: currentEntry.from,
                    to: currentEntry.to,
                    route: route.nodes,
                    progress,
                    started_at: currentEntry.time,
                },
            });
        }
    }
    return states;
}
