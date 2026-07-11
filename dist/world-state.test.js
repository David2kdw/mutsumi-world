import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { readWorld, writeWorld, createEmptyWorld, appendTrajectory } from "./world-state.js";
describe("world-state", () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutsumi-test-"));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    it("createEmptyWorld returns a valid initial state", () => {
        const state = createEmptyWorld("2026-07-11", "weekday");
        assert.strictEqual(state.date, "2026-07-11");
        assert.strictEqual(state.day_type, "weekday");
        assert.strictEqual(state._mutsumi.position.type, "location");
        assert.strictEqual(state._mutsumi.position.name, "家");
        assert.deepStrictEqual(state._mutsumi.trajectory, []);
        assert.deepStrictEqual(state._dm.active_events, []);
    });
    it("writeWorld and readWorld round-trip with atomic write", () => {
        const state = createEmptyWorld("2026-07-11", "weekday");
        state._dm.weather = "晴";
        writeWorld(tmpDir, state);
        const read = readWorld(tmpDir);
        assert.strictEqual(read.date, "2026-07-11");
        assert.strictEqual(read._dm.weather, "晴");
    });
    it("writeWorld writes to .tmp first then renames", () => {
        const state = createEmptyWorld("2026-07-11", "weekday");
        writeWorld(tmpDir, state);
        const worldPath = path.join(tmpDir, "world.json");
        const tmpPath = path.join(tmpDir, ".world.json.tmp");
        assert.ok(fs.existsSync(worldPath));
        // tmp file should not exist after successful write
        assert.ok(!fs.existsSync(tmpPath));
    });
    it("readWorld throws on missing file", () => {
        assert.throws(() => readWorld(tmpDir));
    });
    it("appendTrajectory adds entry to state", () => {
        const state = createEmptyWorld("2026-07-11", "weekday");
        appendTrajectory(state, { time: "08:00", note: "到达教室" });
        assert.strictEqual(state._mutsumi.trajectory.length, 1);
        assert.strictEqual(state._mutsumi.trajectory[0].note, "到达教室");
    });
});
