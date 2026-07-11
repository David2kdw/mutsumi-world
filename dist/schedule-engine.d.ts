import type { ScheduleTemplate, ScheduleEntry } from "./types.js";
export declare function getDayName(dateStr: string): string;
export declare function getDayType(dateStr: string): "weekday" | "saturday" | "sunday";
/**
 * 将模板日程 + class_timetable 展开为完整的带时间段的日程表。
 */
export declare function expandSchedule(template: ScheduleTemplate, dateStr: string): ScheduleEntry[];
/**
 * 找到当前时间对应的日程段。
 */
export declare function findCurrentSegment(schedule: ScheduleEntry[], time: string): ScheduleEntry | null;
/**
 * 找到当前段之后的下一个日程段。
 */
export declare function findNextSegment(schedule: ScheduleEntry[], time: string): ScheduleEntry | null;
