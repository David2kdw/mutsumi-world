import type { NPCsData, NPCScheduleEntry, NPCState, LocationsData, RoadNetwork } from "./types.js";
/**
 * 找到 NPC 当前时间所在的日程段。
 */
export declare function findCurrentNPCSchedule(schedule: NPCScheduleEntry[], time: string): NPCScheduleEntry | null;
/**
 * 计算所有 NPC 在给定时间的状态。
 */
export declare function computeNPCStates(npcs: NPCsData, dayType: string, time: string, locations: LocationsData, network: RoadNetwork): NPCState[];
