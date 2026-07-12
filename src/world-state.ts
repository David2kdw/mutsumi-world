import * as fs from "node:fs";
import * as path from "node:path";
import type { WorldState, TrajectoryEntry } from "./types.js";

const WORLD_FILE = "world.json";
const WORLD_TMP = ".world.json.tmp";

const SPEED_MPS = 1.2; // meters per second walking speed

export function createEmptyWorld(date: string, dayType: "weekday" | "saturday" | "sunday"): WorldState {
  return {
    last_tick: "07:00",
    date,
    day_type: dayType,
    _dm: {
      weather: "",
      schedule: [],
      environment: "",
      active_activity: null,
      dm_activity_count: 0,
    },
    _mutsumi: {
      position: { type: "location", name: "家" },
      trajectory: [],
    },
  };
}

export function readWorld(dataDir: string): WorldState {
  const filePath = path.join(dataDir, WORLD_FILE);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as WorldState;
}

export function writeWorld(dataDir: string, state: WorldState): void {
  const tmpPath = path.join(dataDir, WORLD_TMP);
  const worldPath = path.join(dataDir, WORLD_FILE);

  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmpPath, json, "utf-8");
  fs.renameSync(tmpPath, worldPath);
}

export function appendTrajectory(state: WorldState, entry: TrajectoryEntry): void {
  state._mutsumi.trajectory.push(entry);
}
