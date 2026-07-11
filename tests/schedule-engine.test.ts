import { describe, it } from "node:test";
import assert from "node:assert";
import { expandSchedule, getDayType, getDayName } from "../src/schedule-engine.js";
import type { ScheduleTemplate } from "../src/types.js";

const testTemplate: ScheduleTemplate = {
  weekday: {
    "07:00": "家",
    "08:00": "教室",
    "12:00": "中庭",
    "15:30": "菜园",
    "19:00": "家",
  },
  saturday: { "08:00": "家", "10:00": "菜园", "18:00": "家" },
  sunday: { "08:00": "家", "18:00": "家" },
  class_timetable: {
    "monday": ["数学", "国文", "英语", "体育", "理科", "社会"],
  },
};

describe("schedule-engine", () => {
  it("getDayType returns weekday for Monday", () => {
    assert.strictEqual(getDayType("2026-07-13"), "weekday"); // Monday
  });

  it("getDayType returns saturday", () => {
    assert.strictEqual(getDayType("2026-07-11"), "saturday");
  });

  it("getDayType returns sunday", () => {
    assert.strictEqual(getDayType("2026-07-12"), "sunday");
  });

  it("getDayName returns Japanese name", () => {
    assert.strictEqual(getDayName("2026-07-13"), "monday");
  });

  it("expandSchedule weekday generates class periods", () => {
    const result = expandSchedule(testTemplate, "2026-07-13"); // Monday
    assert.ok(result.length > 10, "should have many segments");

    const firstClass = result.find(s => s.activity === "数学");
    assert.ok(firstClass);
    assert.strictEqual(firstClass!.location, "教室");
    assert.strictEqual(firstClass!.start, "08:00");

    // 课间
    const break1 = result.find(s => s.activity === "课间");
    assert.ok(break1);
  });

  it("expandSchedule saturday has no classes", () => {
    const result = expandSchedule(testTemplate, "2026-07-11");
    const classes = result.filter(s =>
      ["数学", "国文", "英语"].includes(s.activity)
    );
    assert.strictEqual(classes.length, 0);
  });
});
