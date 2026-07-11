import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  LocationsData, RoadNetwork, ScheduleTemplate,
  WeatherData, EventsData, NPCsData, RulesData,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

function readJSON<T>(filepath: string): T {
  const raw = fs.readFileSync(filepath, "utf-8");
  return JSON.parse(raw) as T;
}

export function loadLocations(): LocationsData {
  return readJSON<LocationsData>(path.join(DATA_DIR, "locations.json"));
}

export function loadRoadNetwork(): RoadNetwork {
  return readJSON<RoadNetwork>(path.join(DATA_DIR, "road_network.json"));
}

export function loadScheduleTemplate(): ScheduleTemplate {
  return readJSON<ScheduleTemplate>(path.join(DATA_DIR, "schedule.json"));
}

export function loadWeather(): WeatherData {
  return readJSON<WeatherData>(path.join(DATA_DIR, "weather.json"));
}

export function loadEvents(): EventsData {
  return readJSON<EventsData>(path.join(DATA_DIR, "events.json"));
}

export function loadNPCs(): NPCsData {
  return readJSON<NPCsData>(path.join(DATA_DIR, "npcs.json"));
}

export function loadRules(): RulesData {
  return readJSON<RulesData>(path.join(DATA_DIR, "rules.json"));
}

/**
 * 首次安装时，将 data/ 下的 JSON 文件复制到用户 workspace 的 game/ 目录。
 * 已存在的文件不覆盖（用户可能已手动编辑）。
 */
export function installDataFiles(workspaceDir: string): void {
  const gameDir = path.join(workspaceDir, "game");
  fs.mkdirSync(gameDir, { recursive: true });

  const files = [
    "locations.json", "road_network.json", "schedule.json",
    "weather.json", "events.json", "npcs.json", "rules.json",
  ];

  for (const file of files) {
    const src = path.join(DATA_DIR, file);
    const dest = path.join(gameDir, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}
