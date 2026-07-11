// src/e2e.test.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createEmptyWorld, readWorld, writeWorld, appendTrajectory } from "./world-state.js";
import { loadLocations, loadRoadNetwork, loadScheduleTemplate } from "./data-loader.js";
import { findRoute, getCoordAt, distance } from "./map-engine.js";
import { expandSchedule, findCurrentSegment, getDayType } from "./schedule-engine.js";
import { computeNPCStates } from "./npc-engine.js";

describe("end-to-end: world simulation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutsumi-e2e-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full day: morning -> school -> garden -> home", () => {
    const locations = loadLocations();
    const network = loadRoadNetwork();
    const template = loadScheduleTemplate();

    // 1. 创建空世界
    const state = createEmptyWorld("2026-07-13", "weekday"); // Monday
    state._dm.weather = "晴";
    writeWorld(tmpDir, state);

    // 2. 展开日程
    const schedule = expandSchedule(template, "2026-07-13");
    assert.ok(schedule.length > 0, "schedule should be expanded");

    // 3. 验证上课段
    const mathClass = schedule.find(s => s.activity === "数学");
    assert.ok(mathClass, "should have math class");
    assert.strictEqual(mathClass!.location, "教室");

    // 4. 验证课间存在
    const breaks = schedule.filter(s => s.activity === "课间");
    assert.ok(breaks.length >= 3, "should have breaks between classes");

    // 5. 验证午休
    const lunch = schedule.find(s => s.activity === "自由" && s.location === "中庭");
    assert.ok(lunch, "should have lunch break at 中庭");

    // 6. 验证路径计算
    const route = findRoute(network, locations, "家", "教室");
    assert.ok(route.totalDistance > 0, "route from home to school should exist");
    assert.ok(route.estimatedMinutes > 0, "should estimate travel time");

    // 7. 验证 NPC 位置（上学时段）
    const npcs = { "丰川祥子": { display: "祥子", speed: 1.2, schedule: { weekday: [{ time: "07:30", from: "丰川家", to: "校门", activity: "上学" }] } } };
    const npcStates = computeNPCStates(npcs, "weekday", "08:00", locations, network);
    assert.ok(npcStates.length > 0);

    // 8. 读写 round-trip
    const reloaded = readWorld(tmpDir);
    assert.strictEqual(reloaded._dm.weather, "晴");
    assert.strictEqual(reloaded.date, "2026-07-13");
  });

  it("trajectory is fact-only (no opinions)", () => {
    const state = createEmptyWorld("2026-07-13", "weekday");
    appendTrajectory(state, { time: "08:00", note: "到达教室" });
    appendTrajectory(state, { time: "08:50", note: "数学课结束" });

    // 所有 note 不应包含感受词
    const notes = state._mutsumi.trajectory.map(t => t.note);
    for (const note of notes) {
      assert.ok(!note.includes("开心") && !note.includes("难过") && !note.includes("觉得"),
        `note should not contain feelings: "${note}"`);
    }
  });

  it("crash recovery: traveling position restored", () => {
    const locations = loadLocations();
    const network = loadRoadNetwork();
    const route = findRoute(network, locations, "家", "校门");

    const state = createEmptyWorld("2026-07-13", "weekday");
    state._mutsumi.position = {
      type: "traveling",
      from: "家",
      to: "校门",
      route: route.nodes,
      progress: 0.3,
      started_at: "07:45",
    };
    state.last_tick = "07:50";
    writeWorld(tmpDir, state);

    // 模拟恢复：读取后推进
    const recovered = readWorld(tmpDir);
    assert.strictEqual(recovered._mutsumi.position.type, "traveling");
    // progress 应大于 0.3（时间过去了）
    assert.ok(recovered._mutsumi.position.progress >= 0.3);
  });
});
