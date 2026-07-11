import type { LocationsData, RoadNetwork, ScheduleTemplate, WeatherData, EventsData, NPCsData, RulesData } from "./types.js";
export declare function loadLocations(): LocationsData;
export declare function loadRoadNetwork(): RoadNetwork;
export declare function loadScheduleTemplate(): ScheduleTemplate;
export declare function loadWeather(): WeatherData;
export declare function loadEvents(): EventsData;
export declare function loadNPCs(): NPCsData;
export declare function loadRules(): RulesData;
/**
 * 首次安装时，将 data/ 下的 JSON 文件复制到用户 workspace 的 game/ 目录。
 * 已存在的文件不覆盖（用户可能已手动编辑）。
 */
export declare function installDataFiles(workspaceDir: string): void;
