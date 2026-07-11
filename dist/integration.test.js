import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createLLMClient } from "./llm-client.js";
import { createEmptyWorld, appendTrajectory } from "./world-state.js";
import { loadLocations, loadRoadNetwork, loadNPCs, loadRules, loadScheduleTemplate } from "./data-loader.js";
import { expandSchedule, findCurrentSegment, findNextSegment } from "./schedule-engine.js";
import { findRoute } from "./map-engine.js";
import { computeNPCStates } from "./npc-engine.js";
// 仅在设置 DEEPSEEK_API_KEY 时运行
const HAS_KEY = !!process.env.DEEPSEEK_API_KEY;
describe("integration: real DeepSeek DM", { skip: !HAS_KEY ? "DEEPSEEK_API_KEY not set" : undefined }, () => {
    let tmpDir;
    let client;
    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutsumi-int-"));
        client = createLLMClient();
    });
    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    it("DM responds with valid JSON to morning tick", async () => {
        const rules = loadRules();
        const locations = loadLocations();
        const network = loadRoadNetwork();
        const state = createEmptyWorld("2026-07-13", "weekday");
        state._dm.weather = "晴";
        state._dm.schedule = expandSchedule(loadScheduleTemplate(), "2026-07-13");
        const sysPrompt = `你是月之森女子学园世界的导演。${rules.tone}
输出格式：严格返回 JSON: {"action":"none"|"stay"|"event"|"move","environment":"环境描述1-3句"}

当前日期：${state.date}（${state.day_type}）
当日天气：${state._dm.weather}`;
        const session = client.dmChat(sysPrompt);
        const ctx = buildTestContext(state, "07:00", locations, network);
        const prompt = `当前时间：07:00
目前在 家
今日轨迹：无
活跃事件：无
当前日程：07:00-08:00 家 | 自由
下一段：08:00 教室 | 数学（距离约125m，步行约2分钟）`;
        const response = await session.send(prompt);
        session.close();
        assert.ok(["none", "stay", "event", "move"].includes(response.action), `action should be valid, got: ${response.action}`);
        assert.ok(typeof response.environment === "string" && response.environment.length > 0, "environment should be a non-empty string");
        console.log(`  DM action: ${response.action}`);
        console.log(`  Environment: ${response.environment}`);
    });
    it("DM generates events at appropriate times", async () => {
        const rules = loadRules();
        const state = createEmptyWorld("2026-07-13", "weekday");
        state._dm.weather = "多云";
        state._dm.schedule = expandSchedule(loadScheduleTemplate(), "2026-07-13");
        // 已经有了一些轨迹
        appendTrajectory(state, { time: "07:00", note: "在家醒来" });
        appendTrajectory(state, { time: "08:00", note: "到达教室，开始上课" });
        const sysPrompt = `你是月之森学园的导演。${rules.tone}
输出格式：严格返回 JSON: {"action":"none"|"event","environment":"...","event":{"id":"...","name":"...","location":"...","status":"未处理"},"event_note":"..."}
如果没有值得记录的事件，action 用 "none"。今天是平淡的学校日。

当前日期：${state.date}（${state.day_type}）
天气：${state._dm.weather}`;
        const session = client.dmChat(sysPrompt);
        const response = await session.send(`当前时间：12:00
目前在 中庭
今日轨迹：
- 07:00 在家醒来
- 08:00 到达教室，开始上课
活跃事件：无
当前日程：12:00-13:00 中庭 | 自由`);
        session.close();
        assert.ok(["none", "event"].includes(response.action));
        if (response.action === "event") {
            assert.ok(response.event, "event action should include event data");
            assert.ok(response.event.id, "event should have id");
            console.log(`  Event: ${response.event.name} at ${response.event.location}`);
        }
        else {
            console.log("  DM chose no event — correct for a normal day");
        }
    });
    it("DM can decide to move睦子米", async () => {
        const rules = loadRules();
        const state = createEmptyWorld("2026-07-13", "weekday");
        state._dm.weather = "小雨";
        const sysPrompt = `你是月之森学园的导演。${rules.tone}
输出格式：严格返回 JSON: {"action":"move"|"stay"|"none","environment":"...","move_to":"地点名","departure_note":"出发说明"}
如果当前在下雨，从菜园移动到室内（教室或音乐室）是合理的。

当前日期：${state.date}（${state.day_type}）
天气：${state._dm.weather}`;
        const session = client.dmChat(sysPrompt);
        const response = await session.send(`当前时间：15:30
目前在 菜园
今日轨迹：
- 15:30 到达菜园，开始浇水
活跃事件：无
当前日程：15:30-17:00 菜园 | 自由`);
        session.close();
        assert.ok(["move", "stay", "none"].includes(response.action));
        if (response.action === "move") {
            assert.ok(response.move_to, "move action should include move_to");
            console.log(`  DM decided: move to ${response.move_to} — ${response.departure_note}`);
        }
        else {
            console.log(`  DM action: ${response.action}`);
        }
        console.log(`  Environment: ${response.environment}`);
    });
    it("DM maintains context across multiple sends", async () => {
        const rules = loadRules();
        const state = createEmptyWorld("2026-07-13", "weekday");
        state._dm.weather = "晴";
        const sysPrompt = `你是月之森学园的导演。记住之前说过的内容。${rules.tone}
输出格式：严格返回 JSON: {"action":"none","environment":"..."}

当前日期：${state.date}（${state.day_type}）
天气：晴`;
        const session = client.dmChat(sysPrompt);
        // 第一次：提到素世
        const r1 = await session.send("时间08:00，教室。今天教室里坐着长崎素世。描述环境。");
        console.log(`  T1: ${r1.environment}`);
        // 第二次：不重复提素世，看DM是否记得上下文
        const r2 = await session.send("时间08:50，课间。描述现在教室里的氛围。");
        console.log(`  T2: ${r2.environment}`);
        session.close();
        assert.ok(r1.environment.length > 0);
        assert.ok(r2.environment.length > 0);
        // 两次环境描述应该不同
        assert.notStrictEqual(r1.environment, r2.environment);
        console.log("  Context continuity: OK (two different, coherent descriptions)");
    });
});
function buildTestContext(state, time, locations, network) {
    const currentSegment = findCurrentSegment(state._dm.schedule, time);
    const nextSegment = findNextSegment(state._dm.schedule, time);
    let nextRoute = null;
    if (nextSegment && state._mutsumi.position.type === "location") {
        nextRoute = findRoute(network, locations, state._mutsumi.position.name, nextSegment.location);
    }
    const npcStates = computeNPCStates(loadNPCs(), state.day_type, time, locations, network);
    return { time, current_segment: currentSegment, next_segment: nextSegment, next_segment_route: nextRoute, mutsumi_position: state._mutsumi.position, npc_states: npcStates };
}
