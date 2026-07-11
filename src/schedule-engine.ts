import type { ScheduleTemplate, ScheduleEntry } from "./types.js";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const CLASS_DURATION = 50; // minutes per class
const BREAK_DURATION = 10; // minutes between classes
const LUNCH_DURATION = 60; // minutes

export function getDayName(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[d.getDay()];
}

export function getDayType(dateStr: string): "weekday" | "saturday" | "sunday" {
  const name = getDayName(dateStr);
  if (name === "saturday") return "saturday";
  if (name === "sunday") return "sunday";
  return "weekday";
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * 将模板日程 + class_timetable 展开为完整的带时间段的日程表。
 */
export function expandSchedule(
  template: ScheduleTemplate,
  dateStr: string,
): ScheduleEntry[] {
  const dayType = getDayType(dateStr);
  const dayName = getDayName(dateStr);
  const templateSlots = template[dayType];
  const timetable = template.class_timetable[dayName] || [];

  const entries: ScheduleEntry[] = [];
  const slotTimes = Object.keys(templateSlots).sort();

  for (let i = 0; i < slotTimes.length; i++) {
    const time = slotTimes[i];
    const location = templateSlots[time];
    const nextTime = slotTimes[i + 1] || "23:00";
    const startMin = timeToMinutes(time);
    const endMin = timeToMinutes(nextTime);

    // 检查是否在教室且有课表
    if (location === "教室" && timetable.length > 0) {
      // 计算上午/下午
      const isMorning = startMin < timeToMinutes("12:00");
      const isAfternoon = startMin >= timeToMinutes("13:00");

      if (isMorning) {
        // 上午 4 节课: 08:00-12:00
        let currentMin = Math.max(startMin, timeToMinutes("08:00"));
        for (let ci = 0; ci < 4 && ci < timetable.length && currentMin < endMin; ci++) {
          const classEnd = currentMin + CLASS_DURATION;
          entries.push({
            start: minutesToTime(currentMin),
            end: minutesToTime(classEnd),
            location: "教室",
            activity: timetable[ci],
          });
          currentMin = classEnd;
          if (ci < 3) {
            const breakEnd = currentMin + BREAK_DURATION;
            entries.push({
              start: minutesToTime(currentMin),
              end: minutesToTime(breakEnd),
              location: "教室",
              activity: "课间",
            });
            currentMin = breakEnd;
          }
        }
        // 午休前的收拾时间
        if (currentMin < timeToMinutes("12:00")) {
          entries.push({
            start: minutesToTime(currentMin),
            end: "12:00",
            location: "教室",
            activity: "收拾",
          });
        }
      } else if (isAfternoon) {
        // 下午 2-3 节课: 13:00-15:30
        const afternoonStart = 4; // skip first 4 morning classes
        let currentMin = Math.max(startMin, timeToMinutes("13:00"));
        const afternoonClasses = timetable.slice(afternoonStart);
        for (let ci = 0; ci < afternoonClasses.length && currentMin < endMin; ci++) {
          const classEnd = currentMin + CLASS_DURATION;
          entries.push({
            start: minutesToTime(currentMin),
            end: minutesToTime(classEnd),
            location: "教室",
            activity: afternoonClasses[ci],
          });
          currentMin = classEnd;
          if (ci < afternoonClasses.length - 1) {
            const breakEnd = currentMin + BREAK_DURATION;
            entries.push({
              start: minutesToTime(currentMin),
              end: minutesToTime(breakEnd),
              location: "教室",
              activity: "课间",
            });
            currentMin = breakEnd;
          }
        }
      }
    } else {
      // 非教室时段：直接用模板
      entries.push({
        start: time,
        end: nextTime,
        location,
        activity: location === "家" ? (startMin >= 23 * 60 ? "睡眠" : "自由") : "自由",
      });
    }
  }

  return entries;
}

/**
 * 找到当前时间对应的日程段。
 */
export function findCurrentSegment(
  schedule: ScheduleEntry[],
  time: string,
): ScheduleEntry | null {
  const tMin = timeToMinutes(time);
  for (const entry of schedule) {
    const sMin = timeToMinutes(entry.start);
    const eMin = timeToMinutes(entry.end);
    // 跨午夜处理
    if (sMin <= eMin) {
      if (tMin >= sMin && tMin < eMin) return entry;
    } else {
      if (tMin >= sMin || tMin < eMin) return entry;
    }
  }
  return null;
}

/**
 * 找到当前段之后的下一个日程段。
 */
export function findNextSegment(
  schedule: ScheduleEntry[],
  time: string,
): ScheduleEntry | null {
  const tMin = timeToMinutes(time);
  for (const entry of schedule) {
    if (timeToMinutes(entry.start) > tMin) return entry;
  }
  return null;
}
