// src/npc-engine.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { computeNPCStates, findCurrentNPCSchedule } from "../src/npc-engine.js";
import { loadLocations, loadRoadNetwork, loadNPCs } from "../src/data-loader.js";
import type { NPCsData } from "../src/types.js";

const testNPCs: NPCsData = {
  "丰川祥子": {
    display: "祥子",
    speed: 1.2,
    schedule: {
      weekday: [
        { time: "07:30", from: "丰川家", to: "校门", activity: "上学" },
        { time: "08:00", from: "校门", to: "教室", activity: "上课" },
        { time: "19:00", from: "练习室", to: "丰川家", activity: "回家" },
      ],
    },
  },
};

describe("npc-engine", () => {
  it("findCurrentNPCSchedule finds the correct segment", () => {
    const sched = testNPCs["丰川祥子"].schedule.weekday;
    const result = findCurrentNPCSchedule(sched, "07:45");
    assert.ok(result);
    assert.strictEqual(result!.activity, "上学");
    assert.strictEqual(result!.from, "丰川家");
  });

  it("findCurrentNPCSchedule returns null before first entry", () => {
    const sched = testNPCs["丰川祥子"].schedule.weekday;
    const result = findCurrentNPCSchedule(sched, "06:00");
    assert.strictEqual(result, null);
  });

  it("computeNPCStates returns states for all NPCs", () => {
    const locations = loadLocations();
    const network = loadRoadNetwork();
    // 07:31 is 1 minute after the 07:30 departure from 丰川家→校门 (205 units, ~2.85min travel time)
    const states = computeNPCStates(testNPCs, "weekday", "07:31", locations, network);
    assert.strictEqual(states.length, 1);
    // 祥子 07:30 从丰川家出发去校门，07:31 应该在路上
    const sakiko = states[0]!;
    assert.strictEqual(sakiko.display, "祥子");
    assert.strictEqual(sakiko.position.type, "traveling");
  });
});
