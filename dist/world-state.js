import * as fs from "node:fs";
import * as path from "node:path";
const WORLD_FILE = "world.json";
const WORLD_TMP = ".world.json.tmp";
const SPEED_MPS = 1.2; // meters per second walking speed
export function createEmptyWorld(date, dayType) {
    return {
        last_tick: "07:00",
        date,
        day_type: dayType,
        _dm: {
            weather: "",
            schedule: [],
            environment: "",
            active_events: [],
        },
        _mutsumi: {
            position: { type: "location", name: "家" },
            trajectory: [],
        },
    };
}
export function readWorld(dataDir) {
    const filePath = path.join(dataDir, WORLD_FILE);
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
}
export function writeWorld(dataDir, state) {
    const tmpPath = path.join(dataDir, WORLD_TMP);
    const worldPath = path.join(dataDir, WORLD_FILE);
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(tmpPath, json, "utf-8");
    fs.renameSync(tmpPath, worldPath);
}
export function appendTrajectory(state, entry) {
    state._mutsumi.trajectory.push(entry);
}
